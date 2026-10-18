// PATCH 42 / ChatGPT-powered research through the OpenAI Responses API with web search.
// Research jobs are background jobs; individual HTTP polling requests remain short.
export async function researchSection(openai,model,prompt){
 const r=await openai.responses.create({model,input:[{role:"user",content:prompt+"\nReturn ONLY a valid JSON object. Include cited, directly supporting source URLs, dates, source confidence, and explicit simulation-estimate assumptions. Never claim a live quote or approved AFM performance without evidence."}],tools:[{type:"web_search",search_context_size:"high"}],reasoning:{effort:"low"},max_output_tokens:6500,background:true,store:true});
 return {job_id:r.id,status:r.status};
}
export async function pollResearch(openai,id){
 const r=await openai.responses.retrieve(id);
 if(["queued","in_progress"].includes(r.status))return {job_id:id,status:r.status};
 if(r.status!=="completed")throw Error(r.error?.message||`Research ended: ${r.status}`);
 const s=String(r.output_text||'');const a=s.indexOf('{'),b=s.lastIndexOf('}');
 if(a<0||b<a)throw Error('AI returned no structured research');
 return {job_id:id,status:'completed',data:JSON.parse(s.slice(a,b+1))};
}
const hasValue=v=>v!==null&&v!==undefined&&v!==''&&(!Array.isArray(v)||v.length>0);
const asText=v=>Array.isArray(v)?v.map(asText).join(' | '):typeof v==='object'&&v!==null?Object.entries(v).map(([k,x])=>`${k}: ${asText(x)}`).join(' / '):String(v??'');
function normalAirport(data,key){
 const d={...data,icao:key};
 const identity=data?.airport_identity||{};
 const urls=[...(Array.isArray(data?.sources)?data.sources:[]),identity.source_url,...(Array.isArray(data?.fbos)?data.fbos.map(x=>x.source):[])].filter(x=>typeof x==='string'&&/^https?:\/\//i.test(x));
 const exact=String(data?.icao||'').toUpperCase()===key;
 const claim=String(identity.status||'').toUpperCase();
 d.identity_status=exact&&claim==='VERIFIED'&&urls.length?'VERIFIED':claim==='INVALID'?'INVALID':'RESEARCH_REQUIRED';
 d.identity_evidence=urls;d.identity_reason=String(identity.reason||'');

 for(const field of ['field_summary','field_elevation','runways','frequencies','coordinates','limitations','customs','handling'])if(hasValue(d[field])&&field!=='frequencies')d[field]=asText(d[field]);
 if(!Array.isArray(d.frequencies))d.frequencies=hasValue(d.frequencies)?[asText(d.frequencies)]:[];
 const providers=d.identity_status==='VERIFIED'?[...(Array.isArray(d.fbos)?d.fbos:[]),...(Array.isArray(d.handlers)?d.handlers:[]),...(Array.isArray(d.fuel_suppliers)?d.fuel_suppliers:[])]:[];
 const seen=new Set();d.fbos=providers.filter(v=>v&&typeof v==='object'&&v.name).map(v=>({...v,services:asText(v.services||''),contact:asText(v.contact||v.phone||''),fuels:Array.isArray(v.fuels)?v.fuels:[]})).filter(v=>{const x=v.name.toLowerCase();if(seen.has(x))return false;seen.add(x);return true});
 d.sources=Array.isArray(d.sources)?d.sources:[];d.research_status=d.research_status||'AI WEB RESEARCH COMPLETED — REVIEW SOURCES';
 return d;
}
function normalizeProviders(data){
 const payload=data||{};
 const groups=[payload.providers,payload.fbos,payload.handlers,payload.fuel_suppliers,payload.ground_handlers,payload.fuel_providers];
 const list=groups.flatMap(v=>Array.isArray(v)?v:[]);
 const cleaned=[];const seen=new Set();
 for(const raw of list){
  if(!raw||typeof raw!=='object')continue;
  const name=asText(raw.name||raw.company||raw.provider||'').trim();
  const source=raw.source||raw.source_url||raw.website||'';
  const sources=[source,...(Array.isArray(raw.sources)?raw.sources:[])].filter(x=>typeof x==='string'&&/^https?:\/\//i.test(x));
  if(!name||!sources.length)continue;
  const uniq=name.toUpperCase().replace(/[^A-Z0-9]/g,'');if(seen.has(uniq))continue;seen.add(uniq);
  const fuelItems=raw.fuels||raw.fuel_products||raw.fuel||[];
  const fuels=(Array.isArray(fuelItems)?fuelItems:typeof fuelItems==='object'&&fuelItems?[fuelItems]:[]).map(z=>typeof z==='string'?{type:z,availability:'REPORTED',price_status:'QUOTE REQUIRED'}:{...z,type:z.type||z.grade||z.fuel_type||'',price:z.price||'',price_unit:z.price_unit||z.unit||'',price_updated:z.price_updated||z.date||'',price_status:z.price_status||(z.price?'REPORTED — VERIFY DATE':'NOT PUBLISHED')});
  cleaned.push({name,provider_type:asText(raw.provider_type||raw.category||raw.type||'GROUND SUPPORT'),presence:asText(raw.presence||raw.location_status||'AIRPORT SERVICE — CONFIRM DIRECTLY'),services:asText(raw.services||raw.description||''),contact:asText(raw.contact||raw.phone||raw.email||''),hours:asText(raw.hours||''),fuels,source:sources[0],sources});
 }
 return cleaned;
}
export function mergeResearch(mission,data,section,key){
 if(section==='airport'){
  mission.airport_briefings ||= [];let b=mission.airport_briefings.find(x=>String(x.icao).toUpperCase()===key);
  if(!b){b={icao:key};mission.airport_briefings.push(b)}
  const d=normalAirport(data||{},key);
  // Provider discoveries are independent; preserve source-backed results from prior research.
  if(d.identity_status!=='VERIFIED' && !Array.isArray(b.fbos))b.fbos=[];
  for(const [k,v] of Object.entries(d))if(k!=='icao'&&k!=='fbos'&&hasValue(v))b[k]=v;
  if(d.fbos.length)b.fbos=normalizeProviders({providers:[...d.fbos,...(b.fbos||[])]});
 }else if(section==='providers'){
  mission.airport_briefings ||= [];let b=mission.airport_briefings.find(x=>String(x.icao||'').toUpperCase()===key);
  if(!b){b={icao:key};mission.airport_briefings.push(b)}
  const matches=String(data?.icao||'').toUpperCase()===key;
  const providers=matches?normalizeProviders(data):[];
  if(providers.length){
   const old=Array.isArray(b.fbos)?b.fbos:[];
   b.fbos=normalizeProviders({providers:[...providers,...old]});
   b.handling=providers.map(x=>x.name+' — '+x.provider_type).join(' | ');
   b.fbo_notes='CHATGPT WEB PROVIDER RESEARCH: '+providers.length+' SOURCE-BACKED PROVIDER(S)';
   b.fbo_sources=[...new Set(providers.flatMap(x=>x.sources))];
  }else b.fbo_notes=matches?'PROVIDER RESEARCH COMPLETED; NO SOURCE-BACKED PROVIDERS RETURNED':'PROVIDER RESEARCH RETURNED WRONG ICAO; RETRY';
  if(data?.fuel_price_estimate && matches)b.fuel_price_estimate=data.fuel_price_estimate;
  b.provider_research_status=providers.length?'COMPLETED':'REVIEW REQUIRED';
 }else if(section==='leg'){
  const leg=(mission.legs||[]).find(x=>Number(x.seq)===Number(key));if(!leg)return mission;
  if(data?.fuel_release)leg.fuel_release={...(leg.fuel_release||{}),...data.fuel_release};
  if(data?.told)leg.told={...(leg.told||{}),...data.told};
  if(data?.weight_balance){
   leg.weight_balance={...(leg.weight_balance||{}),...data.weight_balance};
   const w=data.weight_balance;leg.wb_clearance={...(leg.wb_clearance||{}),zero_fuel_weight:w.zfw||w.zero_fuel_weight,takeoff_weight:w.tow||w.takeoff_weight,landing_weight:w.ldw||w.landing_weight,cg:w.cg,cg_limits:w.cg_limits,status:w.status};
  }
  leg.planning_sources=data?.sources||leg.planning_sources||[];
  leg.planning_status=data?.planning_status||'AI WEB RESEARCH COMPLETED — PILOT VERIFICATION REQUIRED';
 }
 return mission;
}
