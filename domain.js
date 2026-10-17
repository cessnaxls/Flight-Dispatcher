import crypto from 'node:crypto';
export const utc=()=>new Date().toISOString();
export const ICAO=/^[A-Z]{4}$/;
export const str=(v,limit=1500)=>String(v??'').trim().slice(0,limit);
export const unique=x=>[...new Set(x.filter(Boolean))];
export const code=v=>str(v,8).toUpperCase();
export const arr=v=>Array.isArray(v)?v:[];
export const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
export function riskProfile(year,condition,ageInfluence=true){
 const conditionName=['GOOD','OK','BAD'].includes(code(condition))?code(condition):'OK';
 const age=year?Math.max(0,new Date().getUTCFullYear()-Number(year)):null;
 const agePoints=ageInfluence&&age!==null?Math.min(36,Math.round(age*.75)):0;
 const score=Math.min(100,Math.max(0,{GOOD:8,OK:34,BAD:65}[conditionName]+agePoints));
 return {condition:conditionName,age_years:age,age_influences_reliability:!!ageInfluence,simulation_risk_score:score,risk_band:score<30?'LOW':score<65?'ELEVATED':'HIGH',note:'Scenario weighting only; not actual aircraft reliability or airworthiness assessment.'};
}
export function normalizeMission(input,request={}){
 const a=obj(input),route=arr(a.route).length?arr(a.route):str(a.route||'').split(/[^A-Za-z0-9]+/).filter(Boolean);
 let legs=arr(a.legs).map((leg,i)=>{
  const x=obj(leg),origin=code(x.origin||x.departure),destination=code(x.destination||x.arrival);
  return {id:str(x.id)||`LEG-${i+1}`,seq:i+1,origin,destination,alternate_icao:code(x.alternate_icao||x.alternate),distance_nm:finite(x.distance_nm),departure_utc:asISO(x.departure_utc||x.departure_time),arrival_utc:asISO(x.arrival_utc||x.arrival_time),flight_time_hours:finite(x.flight_time_hours),payload:obj(x.payload),fuel_release:obj(x.fuel_release),told:obj(x.told),weight_balance:obj(x.weight_balance),notes:str(x.notes),planning_status:'SIMULATION ESTIMATE — NOT RELEASED'};
 }).filter(x=>ICAO.test(x.origin)&&ICAO.test(x.destination)&&x.origin!==x.destination);
 // If the AI returned a valid airport sequence but omitted legs, preserve its chosen itinerary.
 if(!legs.length && route.filter(x=>ICAO.test(code(x))).length>=2){
  const points=route.map(code).filter(x=>ICAO.test(x));
  legs=points.slice(1).map((destination,i)=>({id:`LEG-${i+1}`,seq:i+1,origin:points[i],destination,alternate_icao:'',distance_nm:null,departure_utc:null,arrival_utc:null,flight_time_hours:null,payload:{},fuel_release:{},told:{},weight_balance:{},notes:'Flight times and fuel require AI planning.',planning_status:'PLANNING PENDING'})).filter(l=>l.origin!==l.destination);
 }
 if(!legs.length)throw Error('AI mission lacks usable airport legs or an ICAO route. No mission was saved.');
 const airportCodes=unique(legs.flatMap(l=>[l.origin,l.destination,l.alternate_icao].filter(x=>ICAO.test(x))));
 const ac=obj(a.aircraft),condition=code(request.mx_status||a.mx_status||'OK');
 return {id:str(a.id)||crypto.randomUUID(),code:str(a.code)||`AM-${Date.now().toString(36).toUpperCase()}`,title:str(a.title)||'Untitled charter',type:str(a.type||request.mission_type)||'AI-generated mission',description:str(a.description),scenario:str(a.scenario||a.mission_profile||a.description,8000),mission_profile:str(a.mission_profile||a.scenario,8000),difficulty:str(a.difficulty||request.difficulty)||'NORMAL',status:'PLANNING',created_at:utc(),aircraft:{registration:code(ac.registration||request.registration),icao_type:code(ac.icao_type||request.aircraft_type),model:str(ac.model),manufacturer:str(ac.manufacturer),year_built:Number(ac.year_built)||null,registration_status:'PENDING RESEARCH',registration_sources:[]},mx_status:condition,risk:riskProfile(ac.year_built,condition,request.age_influence!==false),crew:arr(a.crew),passengers:arr(a.passengers),cargo:arr(a.cargo),requirements:arr(a.requirements),documents:arr(a.documents).map(d=>({type:str(obj(d).type),title:str(obj(d).title),purpose:str(obj(d).purpose),submit_to:str(obj(d).submit_to),applicable_legs:arr(obj(d).applicable_legs),fields:arr(obj(d).fields).map(f=>({label:str(obj(f).label),value:str(obj(f).value,1500)})),instructions:str(obj(d).instructions,2500),status:'SIMULATED — NOT FILED'})).filter(d=>d.type||d.title),legs,airport_briefings:airportCodes.map(icao=>({icao,status:'PENDING',sources:[],fbos:[],handlers:[],fuels:[],audit:{stage:'QUEUED'}})),mx:{defects:[],scenario_status:'PENDING'},research:{status:'QUEUED',errors:[],started_at:utc(),completed_at:null},sources:arr(a.sources),schema_version:3};
}
export const finite=v=>v==null||v===''?null:Number.isFinite(Number(v))?Number(v):null;
export function asISO(s){if(!s)return null;const d=new Date(s);return Number.isNaN(d.valueOf())?null:d.toISOString()}
export function normalizeJobs(raw){return arr(raw?.jobs||raw).map((v,i)=>{const j=obj(v);const route=arr(j.route).map(code).filter(x=>ICAO.test(x));if(route.length<2)return null;return {id:str(j.id)||crypto.randomUUID(),title:str(j.title)||'AI assignment',type:str(j.type),description:str(j.description,3000),route,aircraft_type:code(j.aircraft_type),mx_status:code(j.mx_status)||'OK',difficulty:str(j.difficulty),minimum_nm:finite(j.minimum_nm),max_nm:finite(j.max_nm),mission_profile:str(j.mission_profile||j.description,4000),weather_note:str(j.weather_note),status:'AVAILABLE',created_at:utc()}}).filter(Boolean)}
export function normalizeAirport(codeString,data,reference={}){
 const icao=code(codeString),a=obj(data),r=obj(reference),fs=arr(a.frequencies),rs=arr(a.runways);
 const fuels=arr(a.fuels||a.fuel).map(f=>{
  const x=obj(f),numeric=finite(x.price_amount??x.price),type=str(x.price_type,40).toUpperCase();
  let validType=['PUBLISHED','SIMULATION_ESTIMATE','UNAVAILABLE','QUOTE_REQUIRED'].includes(type)?type:'UNAVAILABLE';
  const source_url=safeURL(x.source_url),price_date=str(x.price_date),price_basis=str(x.price_basis);
  let amount=numeric;
  if(validType==='PUBLISHED'&&(!source_url||!price_date)){validType=price_basis?'SIMULATION_ESTIMATE':'QUOTE_REQUIRED';if(!price_basis)amount=null;}
  if(validType==='SIMULATION_ESTIMATE'&&!price_basis){validType='QUOTE_REQUIRED';amount=null;}
  return {provider:str(x.provider||x.supplier),grade:str(x.grade||x.type),availability:str(x.availability)||'UNVERIFIED',price_amount:amount,price_currency:str(x.price_currency||x.currency),price_unit:str(x.price_unit||x.unit),price_type:amount===null?'UNAVAILABLE':validType,price_date,price_basis,source_url};
 }).filter(x=>x.grade||x.provider);
 const providers=(list)=>arr(list).map(p=>({name:str(p.name),services:str(p.services),contact:str(p.contact),hours:str(p.hours),location:str(p.location),source_url:safeURL(p.source_url),source_status:safeURL(p.source_url)?'SOURCED':'UNVERIFIED'})).filter(x=>x.name);
 const name=str(a.name||r.name),elevation_ft=finite(a.elevation_ft??r.elevation_ft),coordinates=str(a.coordinates||(r.latitude&&r.longitude?`${r.latitude}, ${r.longitude}`:''));
 const runways=rs.map(x=>typeof x==='string'?x:str(obj(x).designation||`${obj(x).ident||''} ${obj(x).length_ft||''}ft ${obj(x).surface||''}`)).filter(Boolean);
 const frequencies=fs.map(x=>typeof x==='string'?x:str(obj(x).service||obj(x).name)+' '+str(obj(x).mhz)).filter(Boolean);
 const result={icao,name,municipality:str(a.municipality||r.municipality),country:str(a.country||r.country),elevation_ft,coordinates,runways:runways.length?runways:arr(r.runways),frequencies:frequencies.length?frequencies:arr(r.frequencies),customs:str(a.customs),handling:str(a.handling),limitations:str(a.limitations),operational_notes:str(a.operational_notes),fbos:providers(a.fbos),handlers:providers(a.handlers),fuels,sources:unique(arr(a.sources).map(safeURL).filter(Boolean)),warnings:arr(a.warnings).map(x=>str(x)),retrieved_at:utc(),status:'PARTIAL',audit:{stage:'INTERPRETED',research_characters:0,missing:[]}};
 const missing=[];for(const [field,ok] of Object.entries({name:!!name,runways:!!result.runways.length,frequencies:!!result.frequencies.length,coordinates:!!coordinates,providers:!!([...result.fbos,...result.handlers].some(p=>p.source_status==='SOURCED')),fuel:!!fuels.length,prices:fuels.some(f=>f.price_amount!==null)}))if(!ok)missing.push(field);
 result.status=missing.length?'PARTIAL':'RESEARCHED';result.audit.missing=missing;
 if(!fuels.some(f=>f.price_amount!==null))result.warnings.push('No numerical public price or labeled simulation price was established; request a quote.');
 return result;
}
export function safeURL(v){try{const u=new URL(String(v));return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}}
export function normalizeMx(v,risk){const x=obj(v);return {risk,defects:arr(x.defects).map((d,i)=>({id:`DEF-${i+1}`,equipment:str(d.equipment),category:code(d.category||'INOP'),symptom:str(d.symptom),impact:str(d.impact),mel_reference:str(d.mel_reference),cdl_reference:str(d.cdl_reference),deferral_status:'SIMULATED / NOT APPROVED',msfs_steps:arr(d.msfs_steps).map(v=>str(v)).filter(Boolean),dispatch_limitations:str(d.dispatch_limitations),repair_action:str(d.repair_action),source_urls:arr(d.source_urls).map(safeURL).filter(Boolean)})).filter(d=>d.equipment),scenario_status:'AI GENERATED — REVIEW REQUIRED',notes:str(x.notes,4000)};}
export function normalizeAircraft(v,requested={}){const x=obj(v),registration=code(x.registration||requested.registration);return {registration,icao_type:code(x.icao_type||requested.aircraft_type),model:str(x.model),manufacturer:str(x.manufacturer),year_built:finite(x.year_built),registration_status:['VERIFIED','UNVERIFIED','CONFLICT','NOT_FOUND'].includes(str(x.registration_status,30).toUpperCase())?str(x.registration_status,30).toUpperCase():'UNVERIFIED',registration_sources:arr(x.registration_sources||x.sources).map(safeURL).filter(Boolean),registration_note:str(x.registration_note),last_researched_at:utc()};}
