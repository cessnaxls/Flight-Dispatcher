// PATCH 41: long-running web research using background Responses.
export async function researchSection(openai,model,prompt,options={}){
 const r=await openai.responses.create({model,input:prompt+'\nCite source URLs and retrieval dates. Separate sourced facts from calculated simulation estimates. For research stage return a detailed narrative; for interpretation stage return JSON.',tools:options.web===false?[]:[{type:'web_search',search_context_size:'medium'}],reasoning:{effort:'low'},max_output_tokens:options.web===false?6500:5500,background:true,store:true,...(options.web===false?{text:{format:{type:"json_object"}}}:{})});
 return {job_id:r.id,status:r.status};
}
export async function pollResearch(openai,id,options={}){
 const r=await openai.responses.retrieve(id);
 if(['queued','in_progress'].includes(r.status))return {job_id:id,status:r.status};
 if(r.status!=='completed')throw Error(r.error?.message||`Research ended: ${r.status}`);
 const s=String(r.output_text||'');if(options.raw)return {job_id:id,status:'completed',raw:s};const a=s.indexOf('{'),b=s.lastIndexOf('}');
 if(a<0||b<a)throw Error('No structured research returned');
 return {job_id:id,status:'completed',data:JSON.parse(s.slice(a,b+1))};
}
export function mergeResearch(mission,data,section,key){
 if(section==='airport'){
  const b=(mission.airport_briefings||[]).find(x=>String(x.icao).toUpperCase()===key);
  if(!b)return mission;
  for(const [k,v] of Object.entries(data||{}))if(k!=='icao'&&v!==null&&v!==undefined&&v!==''&&(!Array.isArray(v)||v.length))b[k]=v;
 }else if(section==='leg'){
  const leg=(mission.legs||[]).find(x=>Number(x.seq)===Number(key));if(!leg)return mission;
  for(const k of ['fuel_release','told','weight_balance'])if(data?.[k]&&typeof data[k]==='object')leg[k]={...(leg[k]||{}),...data[k]};
  leg.planning_sources=data?.sources||leg.planning_sources||[];
  leg.planning_status=data?.planning_status||'RESEARCH RETURNED — PIC VERIFICATION REQUIRED';
 }
 return mission;
}
