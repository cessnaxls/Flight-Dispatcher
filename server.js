import express from 'express';
import {createAI} from './ai.js';
import {airportFacts} from './airport-data.js';
import {vatsimLive} from './vatsim.js';
import {renderDispatch} from './pdf.js';
const app=express();app.disable('x-powered-by');app.use(express.json({limit:'2mb'}));app.use(express.static('public',{etag:true,maxAge:'1h'}));
const ai=createAI();const events=[];const attempts=new Map();
function log(level,event,detail=''){events.unshift({time:new Date().toISOString(),level,event,detail:String(detail).slice(0,400)});if(events.length>100)events.pop();}
function safeError(e){return e?.message||'Unknown server error'}
app.get('/api/health',(_req,res)=>res.json({ok:true,version:'3.0.0',aiConfigured:!!process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-4.1',pinRequired:!!process.env.APP_ACCESS_PIN}));
app.use('/api',(req,res,next)=>{if(process.env.APP_ACCESS_PIN&&req.header('X-App-Pin')!==process.env.APP_ACCESS_PIN)return res.status(401).json({error:'Incorrect access PIN. Set it in Settings.'});next()});
app.use('/api/ai',(req,res,next)=>{if(req.path!=='/start')return next();const ip=req.ip||'local',at=Date.now(),a=(attempts.get(ip)||[]).filter(t=>at-t<3600000);if(a.length>=50)return res.status(429).json({error:'AI rate limit: 50 requests/hour per address. Retry later.'});a.push(at);attempts.set(ip,a);next()});
app.post('/api/ai/start',async(req,res)=>{try{const {kind,payload}=req.body||{};const job=await ai.launch(kind,payload);log('START',`AI ${kind} research`,job.job_id);res.json(job);}catch(e){log('ERROR',`AI start ${req.body?.kind}`,safeError(e));res.status(e.status||502).json({error:safeError(e)})}});
app.post('/api/ai/poll',async(req,res)=>{try{const result=await ai.poll(req.body||{});if(result.phase==='complete')log('COMPLETE',`AI ${result.kind} structured`,result.data?.code||'');else if(result.phase==='interpretation')log('STAGE',`AI ${result.kind} interpretation`,result.job_id);res.json(result);}catch(e){log('ERROR',`AI poll ${req.body?.kind}`,safeError(e));res.status(e.status||502).json({error:safeError(e)})}});
app.get('/api/airport/:icao/reference',async(req,res)=>{const icao=String(req.params.icao).toUpperCase();if(!/^[A-Z]{4}$/.test(icao))return res.status(400).json({error:'Invalid ICAO airport'});try{const f=(await airportFacts([icao]))[0];res.json({facts:f})}catch(e){log('WARN',`Airport reference ${icao}`,safeError(e));res.status(503).json({error:`Airport reference unavailable: ${safeError(e)}`})}});
app.get('/api/weather/:icao',async(req,res)=>{const icao=String(req.params.icao).toUpperCase();if(!/^[A-Z]{4}$/.test(icao))return res.status(400).json({error:'Invalid ICAO airport'});try{const r=await fetch(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json`,{signal:AbortSignal.timeout(12000),headers:{'Accept':'application/json','User-Agent':'AeroMissionOps-3'}});if(!r.ok)throw Error(`Weather HTTP ${r.status}`);const v=await r.json();const m=Array.isArray(v)?v[0]:null;res.json(m?{status:'REPORTED',raw:m.rawOb||null,observed_at:m.obsTime||null,source:'NOAA Aviation Weather Center'}:{status:'UNAVAILABLE',raw:null,source:'NOAA Aviation Weather Center'});}catch(e){res.json({status:'UNAVAILABLE',raw:null,error:safeError(e)})}});
app.get('/api/vatsim/live',async(req,res)=>{try{res.json(await vatsimLive(req.query.cid))}catch(e){log('WARN','VATSIM LIVE',safeError(e));res.status(e.status||503).json({error:safeError(e)})}});
app.post('/api/dispatch/pdf',(req,res)=>{try{renderDispatch(req.body?.mission,res)}catch(e){if(!res.headersSent)res.status(e.status||400).json({error:safeError(e)});else res.destroy(e)}});
app.get('/api/debug',(_req,res)=>res.json({events}));
app.use('/api',(_req,res)=>res.status(404).json({error:'Unknown API endpoint'}));
app.use((error,_req,res,_next)=>{log('ERROR','HTTP',safeError(error));res.status(400).json({error:safeError(error)})});
const port=Number(process.env.PORT||3000);if(process.env.NODE_ENV!=='test')app.listen(port,'0.0.0.0',()=>console.log(`AeroMission Ops 3.0 listening on ${port}`));
export default app;
