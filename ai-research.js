// PATCH 40: independent, bounded, web-grounded research. Never alters mission generation.
export async function researchSection(openai,model,prompt,timeout=32000){
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeout);
 try{
  const r=await openai.responses.create({model,input:prompt+'\nReturn one JSON object only. Cite source URLs and retrieval dates. Distinguish observed facts, derived figures and simulation estimates. Never fabricate AFM-approved figures, current fuel prices, runway status or authorizations.',tools:[{type:'web_search',search_context_size:'medium'}],reasoning:{effort:'low'},max_output_tokens:3800},{signal:ac.signal});
  const s=String(r.output_text||'');const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a<0||b<a)throw Error('No structured research returned');return JSON.parse(s.slice(a,b+1));
 }finally{clearTimeout(timer)}
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
