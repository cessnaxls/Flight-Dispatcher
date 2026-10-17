import express from 'express';
import crypto from 'node:crypto';
import {AiGateway} from './ai.js';
import {airportFacts} from './airport-data.js';
import {riskProfile,arr,code,ICAO,str,utc} from './domain.js';
import {vatsimPilot} from './vatsim.js';
import {makeDispatchPDF} from './pdf.js';
import {completeMission} from './pipeline.js';
const app=express();app.disable('x-powered-by');app.use(express.json({limit:'2mb'}));app.use(express.static('public',{extensions:['html']}));
const taskLimits=new Map();
function protectAI(req,res,next){
 const secret=process.env.APP_PASSCODE;
 if(secret){const provided=String(req.headers['x-aeromission-passcode']||'');const a=Buffer.from(provided),b=Buffer.from(secret);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'AeroMission access code required. Set it in Settings to match Render APP_PASSCODE.'})}
 if(req.method==='POST'){const key=req.ip||'unknown',now=Date.now(),recent=(taskLimits.get(key)||[]).filter(time=>now-time<600000);if(recent.length>=20)return res.status(429).json({error:'AI task rate limit reached (20 per 10 minutes). Wait and retry.'});recent.push(now);taskLimits.set(key,recent)}
 next();
}
app.use('/api/tasks',protectAI);app.use('/api/dispatch/pdf',protectAI);app.use('/api/debug',protectAI);
const tasks=new Map(),events=[];function log(level,message,detail={}){events.unshift({at:utc(),level,message,detail});if(events.length>120)events.length=120;console.log(`[${level}] ${message} ${JSON.stringify(detail).slice(0,500)}`)}
const ai=()=>app.locals.ai||new AiGateway();
function task(kind,fn){if([...tasks.values()].filter(t=>t.status==='RUNNING').length>=8)throw Object.assign(Error('Too many active AI tasks. Try again after one finishes.'),{status:429});const id=crypto.randomUUID(),data={id,kind,status:'RUNNING',stage:'QUEUED',detail:'Waiting to start',created_at:utc(),updated_at:utc(),history:[],partial:null,result:null,error:null};tasks.set(id,data);const progress=(stage,detail)=>{data.stage=stage;data.detail=detail;data.updated_at=utc();data.history.push({at:data.updated_at,stage,detail});log('PROGRESS',kind+': '+stage,{id,detail})};const publish=(partial)=>{data.partial=JSON.parse(JSON.stringify(partial));data.updated_at=utc()};setImmediate(async()=>{try{const result=await fn({progress,publish});data.result=result;data.status='COMPLETE';progress('COMPLETE',`${kind} completed`)}catch(e){data.status='FAILED';data.error=e.message||'Unknown AI error';progress('FAILED',data.error);log('ERROR',kind+' failed',{id,error:data.error})}});return {id,status:'RUNNING'}}
function expire(){const now=Date.now();for(const [id,t] of tasks)if(t.status!=='RUNNING'&&now-Date.parse(t.updated_at)>6*60*60*1000)tasks.delete(id)}setInterval(expire,15*60*1000).unref();
async function refMap(codes){try{const data=await airportFacts(codes);return new Map(data.map(r=>[r.icao,r]))}catch(e){log('WARN','Aerodrome reference unavailable',{error:e.message});return new Map()}}
function allCodes(m){return [...new Set(arr(m.legs).flatMap(l=>[l.origin,l.destination,l.alternate_icao]).map(code).filter(x=>ICAO.test(x)))];}

async function awc(type,icao){const url=`https://aviationweather.gov/api/data/${type}?ids=${encodeURIComponent(icao)}&format=raw`;const r=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'AeroMissionOpsSimulation/3.0'}});if(r.status===204)return null;if(!r.ok)throw Error(`${type} HTTP ${r.status}`);const body=(await r.text()).trim();return body||null}
async function getWeather(icao){const [metar,taf]=await Promise.allSettled([awc('metar',icao),awc('taf',icao)]);return {metar:metar.status==='fulfilled'?metar.value:null,taf:taf.status==='fulfilled'?taf.value:null,status:metar.status==='fulfilled'||taf.status==='fulfilled'?'RETRIEVED':'UNAVAILABLE',retrieved_at:utc(),source:'NOAA Aviation Weather Center',errors:[metar,taf].filter(x=>x.status==='rejected').map(x=>x.reason?.message)}}
app.get('/api/health',(_req,res)=>res.json({ok:true,version:'3.0.0',aiConfigured:!!process.env.OPENAI_API_KEY||!!app.locals.ai,model:process.env.OPENAI_MODEL||'gpt-4.1',vatsim:true,apiVersion:3}));
app.get('/api/debug',(_req,res)=>res.json({events:events.slice(0,80)}));
app.get('/api/tasks/:id',(req,res)=>{const t=tasks.get(req.params.id);if(!t)return res.status(404).json({error:'AI task no longer available (server restarted or expired). Saved browser mission data is unaffected.'});res.setHeader('Cache-Control','no-store');res.json(t)});
app.post('/api/tasks/mission',(req,res,next)=>{try{const request=req.body||{};res.status(202).json(task('MISSION',async({progress,publish})=>{const m=await ai().mission(request,progress);publish(m);return {mission:await completeMission(m,request,{progress,publish,gateway:ai(),referenceLoader:refMap,weatherLoader:getWeather,log})}}))}catch(e){next(e)}});
app.post('/api/tasks/jobs',(req,res,next)=>{try{const request=req.body||{};res.status(202).json(task('JOBS',async({progress})=>await ai().jobs(request,progress)))}catch(e){next(e)}});
app.post('/api/tasks/airport',(req,res,next)=>{try{const icao=code(req.body?.icao);if(!ICAO.test(icao))return res.status(400).json({error:'Valid four-letter ICAO required'});res.status(202).json(task('AIRPORT',async({progress})=>{const refs=await refMap([icao]);const briefing=await ai().airport(icao,refs.get(icao)||{},progress);briefing.weather=await getWeather(icao);return {briefing}}))}catch(e){next(e)}});
app.post('/api/tasks/airports',(req,res,next)=>{try{const codes=[...new Set(arr(req.body?.icaos).map(code).filter(x=>ICAO.test(x)))].slice(0,15);if(!codes.length)return res.status(400).json({error:'Provide valid four-letter airport ICAOs'});res.status(202).json(task('AIRPORTS',async({progress})=>{const refs=await refMap(codes),briefings=[],errors=[];let next=0;async function worker(){while(next<codes.length){const icao=codes[next++];progress('AIRPORT_RESEARCH',`Refreshing ${icao} with AI sources`);try{const brief=await ai().airport(icao,refs.get(icao)||{},(stage,detail)=>progress(`${icao}_${stage}`,detail));brief.weather=await getWeather(icao);briefings.push(brief)}catch(e){errors.push({subject:icao,error:e.message});log('WARN','Airport re-research failed',{icao,error:e.message})}}}await Promise.all(Array.from({length:Math.min(2,codes.length)},()=>worker()));if(!briefings.length)throw Error(`All ${codes.length} airport re-research attempts failed: ${errors.map(e=>e.subject).join(', ')}`);return {briefings,errors,requested:codes}}))}catch(e){next(e)}});
app.post('/api/tasks/aircraft',(req,res,next)=>{try{res.status(202).json(task('AIRCRAFT',async({progress})=>{const aircraft=await ai().aircraft(req.body||{},progress);const mx=await ai().mx(aircraft,req.body||{},progress);return {aircraft,mx}}))}catch(e){next(e)}});
app.get('/api/weather/:icao',async(req,res)=>{const icao=code(req.params.icao);if(!ICAO.test(icao))return res.status(400).json({error:'Invalid ICAO'});res.json(await getWeather(icao))});
app.get('/api/vatsim/pilot',async(req,res)=>{try{const result=await (app.locals.vatsim||vatsimPilot)(req.query.cid);res.setHeader('Cache-Control','no-store');res.json({...result,checked_at:utc()})}catch(e){res.status(503).json({error:e.message})}});
app.post('/api/dispatch/pdf',(req,res)=>{try{const m=req.body?.mission;if(!m||!Array.isArray(m.legs)||m.legs.length===0)return res.status(400).json({error:'Select a valid mission before printing'});makeDispatchPDF(m,res)}catch(e){if(!res.headersSent)res.status(500).json({error:'PDF failed: '+e.message});else res.destroy(e)}});
app.use((req,res)=>{if(req.path.startsWith('/api/'))res.status(404).json({error:'Unknown API route'});else res.status(404).send('Not found')});
app.use((err,_req,res,_next)=>{log('ERROR','Request error',{error:err.message});res.status(err.status||500).json({error:err.message||'Server error'})});
if(process.env.NODE_ENV!=='test'){const port=Number(process.env.PORT||3000);app.listen(port,'0.0.0.0',()=>console.log(`AeroMission Ops AI Rebuild ready on ${port}`))}
export default app;
