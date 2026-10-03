import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
app.use(express.json({limit:"3mb"}));
app.use(express.static(path.join(__dirname,"public")));

// PATCH 11: lightweight server-side generation progress. The browser polls this
// so the progress panel reflects real backend phases instead of a fake timer.
const generationProgress=new Map();
function setGenerationProgress(id,pct,stage,detail=""){
  if(!id) return;
  generationProgress.set(String(id),{pct,stage,detail,updated:Date.now()});
  setTimeout(()=>{const x=generationProgress.get(String(id)); if(x&&Date.now()-x.updated>120000) generationProgress.delete(String(id));},125000);
}
app.get("/api/generation/:id",(req,res)=>res.json(generationProgress.get(String(req.params.id))||{pct:0,stage:"QUEUED",detail:""}));

const modelAllow=new Set(["gpt-6-luna","gpt-6-sol","gpt-6-astra","gpt-5.6-sol"]);
function client(req){
  const key=process.env.OPENAI_API_KEY;
  if(!key) throw new Error("OPENAI_API_KEY is not configured on Render.");
  return new OpenAI({apiKey:key});
}
const debugLog=[];
function debugEvent(kind,message,meta={}){
  const e={time:new Date().toISOString(),kind,message,...meta};
  debugLog.unshift(e); if(debugLog.length>200) debugLog.length=200;
  console.log(`[AeroMission ${kind}] ${message}`,meta);
}
app.get("/api/debug",(req,res)=>res.json({events:debugLog.slice(0,100)}));
debugEvent("INFO","PATCH 15 generation engine loaded",{mode:"FAST_NO_WEB_FOR_JOBS_AND_MISSIONS",primary_timeout_ms:32000,repair_timeout_ms:8000,correction_timeout_ms:12000});

function extractJSONObject(text){
  let t=String(text||"").trim();
  t=t.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"").trim();
  try{return JSON.parse(t)}catch{}
  const first=t.indexOf("{"); if(first<0) throw new Error("AI response contained no JSON object.");
  let depth=0,inString=false,escape=false;
  for(let i=first;i<t.length;i++){
    const ch=t[i];
    if(inString){ if(escape)escape=false; else if(ch==="\\")escape=true; else if(ch==='"')inString=false; continue; }
    if(ch==='"'){inString=true;continue} if(ch==="{")depth++; else if(ch==="}"){depth--;if(depth===0)return JSON.parse(t.slice(first,i+1));}
  }
  throw new Error("AI JSON object was truncated.");
}
async function responseWithTimeout(c,params,ms){
  const ac=new AbortController(); const timer=setTimeout(()=>ac.abort(),ms);
  try{return await c.responses.create(params,{signal:ac.signal})}finally{clearTimeout(timer)}
}
async function aiJSON(req,res,prompt,{web=true,transform=null}={}){
  // PATCH 12 FAST PATH: one web-enabled generation call, then parse its JSON.
  // A small JSON-only repair call is used only when the primary answer is malformed.
  const requested=String(req.body?.model||process.env.OPENAI_MODEL||"gpt-6-luna");
  const model=modelAllow.has(requested)?requested:"gpt-6-luna";
  const c=client(req), progressId=req.body?._generation_id||"", started=Date.now();
  const requestKind=req.path.includes("jobs")?"JOB BOARD":req.path.includes("mission")?"MISSION":req.path.includes("ops")?"OPS":"AI";
  setGenerationProgress(progressId,8,"STARTING","Preparing AI request");
  debugEvent("START",`${requestKind} generation started`,{id:progressId,web,model});
  let raw="", data, primaryError=null;
  try{
    setGenerationProgress(progressId,25,web?"AI + WEB RESEARCH":"AI GENERATION",web?"Generating while searching current public sources":"Generating structured data");
    const params={model,input:`${prompt}\n\nOUTPUT CONTRACT: Return exactly ONE complete JSON object. No Markdown fences and no prose before or after the object.`,max_output_tokens:web?14000:10000};
    if(web) params.tools=[{type:"web_search",search_context_size:"low"}];
    const r=await responseWithTimeout(c,params,web?45000:32000);
    if(r.status==="incomplete") throw new Error(`Primary response incomplete${r.incomplete_details?.reason?`: ${r.incomplete_details.reason}`:""}`);
    if(r.status==="failed") throw new Error(r.error?.message||"Primary AI request failed.");
    raw=String(r.output_text||"").trim();
    if(!raw) throw new Error("AI returned an empty response.");
    setGenerationProgress(progressId,86,"VALIDATING","Validating generated data");
    data=extractJSONObject(raw);
  }catch(e){primaryError=e;debugEvent("WARN",`${requestKind} primary generation needs repair`,{id:progressId,error:e?.message||String(e),elapsed_ms:Date.now()-started});}
  if(!data){
    try{
      setGenerationProgress(progressId,90,"JSON REPAIR","Repairing response formatting");
      const repairInput=`Convert the following attempted response into ONE valid JSON object only. Preserve its data; do not research or add commentary.\n\n${raw||"{}"}`;
      const r=await responseWithTimeout(c,{model,input:repairInput,text:{format:{type:"json_object"}},max_output_tokens:10000},8000);
      data=JSON.parse(String(r.output_text||"{}"));
    }catch(e){
      const detail=primaryError?.message||e?.message||"AI generation failed";
      debugEvent("ERROR",`${requestKind} generation failed`,{id:progressId,error:detail,elapsed_ms:Date.now()-started});
      setGenerationProgress(progressId,100,"FAILED",detail);
      return res.status(502).json({error:`AI generation could not complete. ${detail}`,generation_id:progressId});
    }
  }
  try{
    if(!data||typeof data!=="object"||Array.isArray(data)) throw new Error("AI returned the wrong JSON shape.");
    if(transform)data=transform(data);
    setGenerationProgress(progressId,100,"COMPLETE",`Completed in ${((Date.now()-started)/1000).toFixed(1)}s`);
    debugEvent("COMPLETE",`${requestKind} generation completed`,{id:progressId,elapsed_ms:Date.now()-started});
    return res.json(data);
  }catch(e){
    // PATCH 14: validation failures get one fast corrective pass instead of
    // throwing away an otherwise useful researched response. This pass does
    // not repeat web search, so it stays quick and preserves researched facts.
    const validationError=e?.message||String(e);
    debugEvent("WARN",`${requestKind} validation failed; attempting correction`,{id:progressId,error:validationError,elapsed_ms:Date.now()-started});
    try{
      setGenerationProgress(progressId,93,"CORRECTING","Correcting generated mission data");
      const correction=`The JSON below was generated for this request but failed application validation. Correct ONLY what is necessary to satisfy the validation error and original output contract. Preserve researched facts and all usable mission/job details. If the original request left controls blank, invent complete assignment values rather than returning a setup-required response. Return one complete JSON object only.\n\nVALIDATION ERROR: ${validationError}\n\nORIGINAL REQUEST:\n${prompt}\n\nGENERATED JSON:\n${JSON.stringify(data)}`;
      const rr=await responseWithTimeout(c,{model,input:correction,text:{format:{type:"json_object"}},max_output_tokens:10000},12000);
      let corrected=JSON.parse(String(rr.output_text||"{}"));
      if(transform)corrected=transform(corrected);
      setGenerationProgress(progressId,100,"COMPLETE",`Completed in ${((Date.now()-started)/1000).toFixed(1)}s`);
      debugEvent("COMPLETE",`${requestKind} generation corrected and completed`,{id:progressId,elapsed_ms:Date.now()-started});
      return res.json(corrected);
    }catch(e2){
      const detail=e2?.message||validationError;
      debugEvent("ERROR",`${requestKind} validation correction failed`,{id:progressId,error:detail,initial_error:validationError,elapsed_ms:Date.now()-started});
      setGenerationProgress(progressId,100,"FAILED",detail);
      return res.status(502).json({error:`Generated data failed validation. ${detail}`,generation_id:progressId});
    }
  }
}
function zonedLocalToZulu(localIso, timeZone){
  // Convert an AI-supplied wall-clock ISO time + IANA timezone into UTC.
  // Iterate the Intl offset so DST and non-whole-hour zones are handled by the runtime.
  if(!localIso || !timeZone) return "";
  const m=String(localIso).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if(!m) return "";
  const wanted=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],0);
  let guess=wanted;
  try{
    for(let i=0;i<4;i++){
      const parts=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess));
      const o=Object.fromEntries(parts.map(x=>[x.type,x.value]));
      const shown=Date.UTC(+o.year,+o.month-1,+o.day,+o.hour,+o.minute,0);
      guess += wanted-shown;
    }
    return new Date(guess).toISOString().slice(11,16)+"z";
  }catch{return "";}
}
function normalizeIcao(v){ const x=String(v||"").toUpperCase().trim(); return /^[A-Z]{4}$/.test(x)?x:""; }
function normalizeDifficulty(v){ return String(v??"").replace(/%/g,"").trim(); }
function finalizeLeg(l){
  l.origin=normalizeIcao(l.origin); l.destination=normalizeIcao(l.destination);
  l.depart_z=zonedLocalToZulu(l.depart_local_iso,l.origin_timezone)||String(l.depart_z||"").replace(/%/g,"");
  l.arrive_z=zonedLocalToZulu(l.arrive_local_iso,l.destination_timezone)||String(l.arrive_z||"").replace(/%/g,"");
  return l;
}
function finalizeJob(j){
  j.origin=normalizeIcao(j.origin); j.destination=normalizeIcao(j.destination);
  j.difficulty=normalizeDifficulty(j.difficulty);
  j.leg_schedule=(j.leg_schedule||[]).map(finalizeLeg).filter(l=>l.origin&&l.destination);
  j.legs=j.leg_schedule.length||Number(j.legs)||1;
  if(j.leg_schedule[0]) j.depart_z=j.leg_schedule[0].depart_z;
  if(j.leg_schedule.at(-1)) j.arrive_z=j.leg_schedule.at(-1).arrive_z;
  return j;
}
function validateZuluLegs(legs,label="generation"){
  if(!Array.isArray(legs)||!legs.length) throw new Error(`${label} returned no usable legs.`);
  const bad=legs.find(l=>!l.depart_z||!l.arrive_z);
  if(bad) throw new Error(`${label} omitted a valid local ISO time or IANA timezone for leg ${bad.seq||"?"}; retrying.`);
}
function finalizeMission(data){
  const title=String(data?.title||"").trim(), story=String(data?.story||"").trim(), operation=String(data?.operation||"").trim(), aircraft=String(data?.aircraft_type||"").trim();
  if(/AM-UNASSIGNED/i.test(String(data?.code||""))||/Mission Setup Required|details are incomplete|no legs.*can be established/i.test(`${title} ${story}`)) throw new Error("Mission generator returned a setup/incomplete mission instead of a real assignment.");
  if(!title||!operation||!aircraft) throw new Error("Mission generator omitted required assignment identity fields.");
  data.legs=(data.legs||[]).map(finalizeLeg).filter(l=>l.origin&&l.destination);
  validateZuluLegs(data.legs,"Mission");
  for(const l of data.legs){
    l.passengers=Array.isArray(l.passengers)?l.passengers:[];
    l.crew=Array.isArray(l.crew)?l.crew:[];
    l.pax=l.passengers.length;
    l.crew_count=l.crew.length;
    const pw=l.passengers.reduce((a,p)=>a+(Number(p.weight_lb)||0),0);if(pw)l.passenger_weight_lb=pw;
  }
  const visible=JSON.stringify({title:data.title,story:data.story,mx_profile:data.mx_profile,open_items:data.open_items,paperwork:data.paperwork,airport_briefings:data.airport_briefings});
  if(/\b(simulation|training|scenario|fictional|placeholder|TBD|unverified)\b/i.test(visible)) throw new Error("Mission output contained immersion-breaking placeholder/disclaimer language; retrying.");
  return data;
}
function finalizeOps(data){
  const docs=Array.isArray(data.documents)?data.documents:(data.document?[data.document]:[]);
  for(const d of docs){
    d.filename=String(d.filename||"OPS_DOCUMENT").replace(/\.[A-Za-z0-9]+$/i,"")+".pdf";
    const text=JSON.stringify(d);
    if(/\b(TBD|UNKNOWN|PENDING|PLACEHOLDER|UNVERIFIED)\b|role[- ]unconfirmed/i.test(text)) throw new Error("Ops document contained placeholder language; retrying with completed details.");
  }
  data.documents=docs;delete data.document;return data;
}

app.get("/api/health",(req,res)=>res.json({ok:true,aiConfigured:!!process.env.OPENAI_API_KEY}));

app.post("/api/jobs",(req,res)=>{
 const f=req.body||{};
 const units=(f.units||"IMPERIAL").toUpperCase();
 aiJSON(req,res,`You are the AI operations backend for AeroMission Ops.
Return STRICT JSON {"jobs":[...]} with exactly 8 varied assignments. Deliberately vary leg counts across the board from 1 to 4 legs; do not make every assignment one leg.
The graphical app is only an interface; YOU develop the assignment, mission profile, aircraft, payload, schedule, operational texture, aircraft-appropriate maintenance context, and paperwork requirements.
Aircraft may be ANY plausible real aircraft type and are NOT restricted to the user's fleet. For every generated aircraft, use web research to select a REAL publicly documented registration/tail whose real-world aircraft type matches the generated aircraft. Never invent registrations; if no real tail can be verified, leave registration_hint blank.
Starting point filter: ${JSON.stringify(f.start||"ANYWHERE")}. Treat it as airport/city/state/province/country/region/free-form geography.
Operation filter: ${JSON.stringify(f.operation||"AI DECIDES")}; aircraft filter: ${JSON.stringify(f.aircraft||"AI DECIDES")}; distance ${f.minNm||75}-${f.maxNm||1800} NM; Display-unit preference: ${units}. difficulty filter ${JSON.stringify(f.difficulty||"ALL LEVELS")}. If ALL LEVELS, deliberately mix easy, moderate, hard, and very demanding jobs. Requested aircraft MX band: ${JSON.stringify(f.mx_status||"RANDOM")}. Age influences MX: ${f.age_influences_mx!==false}. Apply the MX model below when creating each job.
Generate concise weather/airport context suitable for assignment discovery. Do not claim observations are live/current unless supplied in the request. ALL airport identifiers in origin, destination, and leg_schedule MUST be four-letter ICAO codes only (examples KIND, KDEN, EGLL, RJTT), never three-letter IATA codes. Return operation as a concise operation category for every job. Fuel availability and pricing are grade-specific. Treat 100LL/AVGAS and Jet A/Jet A-1 as separate products with separate availability and separate prices. Never use one price for both. If a grade is unavailable, return UNAVAILABLE and no price. If available but a current public price cannot be verified, generate a plausible randomized numeric price appropriate to that grade, airport and region.
MX MODEL: RANDOM may span the full range. BAD means really bad through sub-average; OK means ordinary/average; GOOD means above-average through excellent. The selected band biases condition but does not make age deterministic. When age influence is enabled, aircraft age changes the probability/severity of wear, deferred items and inspection findings, but old aircraft may be excellent and new aircraft may be poor. Location influences condition through concrete environmental/operational factors such as salt/coastal exposure, humidity, desert dust, extreme cold/heat, outdoor storage, utilization tempo, remote maintenance access and parts/logistics; never treat a country/region itself as a quality score. Return mx_status and a concise mx_risk rationale.
Each job: id,title,operation,urgency,origin,destination,origin_name,destination_name,aircraft_type,registration_hint,registration_status,distance_nm,legs,difficulty,depart_local,arrive_local,weather_hook,weather_checked_at,payload_summary,pax_summary,mx_risk,route_character,legal_hook,story,leg_schedule[{seq,origin,destination,depart_local,arrive_local,depart_local_iso:"YYYY-MM-DDTHH:MM",arrive_local_iso:"YYYY-MM-DDTHH:MM",origin_timezone:"IANA timezone",destination_timezone:"IANA timezone",distance_nm}]. depart_local_iso, arrive_local_iso, origin_timezone and destination_timezone are REQUIRED for every leg. Use valid IANA timezone names such as America/Denver. Do NOT calculate Zulu yourself; the server calculates it from local ISO + IANA timezone.`,{web:false,transform:data=>{const jobs=(data.jobs||[]).map(j=>{j=finalizeJob(j);j.mx_status=j.mx_status||f.mx_status||"RANDOM";j.age_influences_mx=f.age_influences_mx!==false;return j}).filter(j=>j.origin&&j.destination);if(jobs.length!==8)throw new Error(`Job Board returned ${jobs.length} usable jobs instead of 8.`);for(const j of jobs)validateZuluLegs(j.leg_schedule,`Job ${j.id||j.title||"?"}`);return {jobs}}});
});

app.post("/api/aircraft",(req,res)=>{
 const {registration="",type="",start=""}=req.body||{};
 aiJSON(req,res,`AeroMission Ops aircraft research.
Registration supplied: ${registration||"NONE"}. ICAO/type supplied: ${type||"NONE"}. Starting geography: ${start||"NONE"}.
If a registration is supplied, research public sources and match it to the real aircraft only when verifiable. Do not fabricate identity. If an ICAO type is supplied without a registration, find a plausible publicly documented tail consistent with the starting geography when possible; otherwise leave the registration blank rather than inventing one.
Return STRICT JSON: {"registration":"","aircraft_type":"","display_name":"","identity_status":"VERIFIED PUBLIC MATCH|PLAUSIBLE PUBLIC MATCH|UNRESOLVED","operator":"","year":"","serial":"","fuel_type":"","fuel_capacity":"","weight_context":"","payload_context":"","range_context":"","runway_context":"","engine_context":"","systems_context":"","health":number,"initial_state":{"airframe_hours":number,"cycles":number,"engine_hours":number},"inspections":[{"name":"","basis":"","due_date":"","due_hours":number,"due_cycles":number,"notes":""}],"mx_domains":[],"sources":[]}.
Inspection times are generated app records randomized plausibly for aircraft category and are not claims about the real aircraft maintenance history.`);
});

app.post("/api/mission",(req,res)=>{
 const x=req.body||{};
 const units=(x.units||"IMPERIAL").toUpperCase();
 aiJSON(req,res,`Create a detailed AeroMission Ops mission from these controls/job. IMPORTANT: blank/empty user controls mean AI DECIDES; they are NEVER missing requirements. You MUST invent a complete operation, aircraft, route, schedule, manifests and mission when controls are blank. Never return AM-UNASSIGNED, Mission Setup Required, or an incomplete/setup-required mission. USER DISPLAY UNITS: ${units}. If IMPERIAL, ALL generated/displayed lengths, runway dimensions, elevations, weights, fuel quantities, temperatures and performance figures must use imperial aviation units (ft, lb, gal where appropriate, deg F). If METRIC, use m, kg, L and deg C. Do not mix systems except when a source quote is unavoidable. Return local wall-clock times plus IANA timezones; the server will CALCULATE UTC/Zulu times. ALL airport identifiers MUST be four-letter ICAO codes only, never IATA codes:
${JSON.stringify(x)}
MX CONDITION MODEL: Requested MX band is ${JSON.stringify(x.mx_status||x.job?.mx_status||"RANDOM")}; age influence is ${(x.age_influences_mx ?? x.job?.age_influences_mx)!==false}. RANDOM may span the full range. BAD = really bad through sub-average; OK = average; GOOD = above-average through excellent. Use the band to control the number and severity of MEL/CDL/MX/INOP items. Age is an influence, not destiny: an old aircraft can be meticulously maintained or awful; a new aircraft can be neglected or pristine. Location also influences condition only through concrete exposure/operations factors such as salt air/corrosion, humidity, desert dust, cold/heat cycling, outdoor storage, high utilization, remote maintenance access, and parts/logistics. Do not use nationality/region as a maintenance-quality proxy. Keep outcomes varied and plausible. Generated MX condition is internal app state and must never be represented as the actual maintenance history or airworthiness status of the publicly matched registration. Do not put simulation/training disclaimers in mission story, MX descriptions, limitations, airport briefs, or paperwork text. Do not use the words simulation, training, scenario, fictional, placeholder, TBD, or unverified in any user-visible mission field unless the user explicitly asks for that terminology.
Payload logic is mission-specific and MUST be recalculated independently for every leg. Do not copy payload from another mission or mechanically repeat the first leg. Track loading and unloading. payload_lb must equal passenger_weight_lb + baggage_lb + cargo_lb + equipment_lb and remain plausible for the selected aircraft. If no registration was explicitly supplied, use web research to select a REAL publicly documented tail whose actual aircraft type EXACTLY matches aircraft_type. Do not substitute a nearby subtype or family variant. If the user explicitly supplied an aircraft type, that requested type has priority and the selected tail must match it. Never invent a registration. When an exact public match is found, do not clutter the mission story with identity-verification commentary; place identity state only in registration_status. For EVERY leg, return a complete passenger, crew, and cargo manifest. passengers must contain PASSENGERS ONLY, never flight crew. crew must be a separate array with role, full_name and weight_lb. pax must equal passengers.length; crew_count must equal crew.length. If the mission narrative calls for 12 VIPs plus 5 crew, return 12 passengers and 5 crew, not 17 passengers. Passenger entries need full_name, weight_lb, dob (YYYY-MM-DD), and, when that leg crosses an international border, passport_country (ISO 3166-1 alpha-3 three-letter code) and passport_number. Crew identities may be fictional unless the user supplied a name/role. For domestic legs, passport fields may be blank. Use fictional identities for generated people and never copy personal data from public sources. passenger_weight_lb must equal the sum of passenger weight_lb values. cargo_manifest must list every cargo item with description, quantity, weight_lb, hazmat boolean, and when hazmat=true include simulated un_number, proper_shipping_name, hazard_class, packing_group, and handling_notes. cargo_lb must equal the sum of cargo_manifest item weights. Do not hide cargo in generic manifest_summary text. If there is no cargo return an empty array.
Return STRICT JSON {"code":"","title":"","operation":"","story":"","registration":"","registration_status":"VERIFIED PUBLIC MATCH","aircraft_type":"","balance":number,"mx_profile":{"requested_band":"RANDOM|BAD|OK|GOOD","resolved_condition":"","age_influence":true,"location_factors":[""],"summary":""},"legs":[{"seq":1,"origin":"","destination":"","distance_nm":number,"depart_local":"","arrive_local":"","depart_local_iso":"YYYY-MM-DDTHH:MM","arrive_local_iso":"YYYY-MM-DDTHH:MM","origin_timezone":"IANA timezone","destination_timezone":"IANA timezone","international":false,"pax":number,"passengers":[{"full_name":"","weight_lb":number,"dob":"YYYY-MM-DD","passport_country":"","passport_number":""}],"crew_count":number,"crew":[{"role":"PIC|SIC|CABIN CREW|MISSION CREW","full_name":"","weight_lb":number}],"passenger_weight_lb":number,"baggage_lb":number,"cargo_lb":number,"cargo_manifest":[{"description":"","quantity":number,"weight_lb":number,"hazmat":false,"un_number":"","proper_shipping_name":"","hazard_class":"","packing_group":"","handling_notes":""}],"equipment_lb":number,"payload_lb":number,"cargo_description":"","manifest_summary":"","weather_context":"","fuel_plan":"","airport_brief":""}],"open_items":[{"category":"MEL|CDL|MX|MISSION EQUIPMENT","description":"","limitation":"","source_note":""}],"paperwork":[{"doc_type":"","submit_to":"","requirement":""}],"airport_briefings":[{"icao":"","field_summary":"","runways":"","field_elevation":"","weather":"","limitations":"","customs":"","handling":"","fbos":[{"name":"","services":"","fuels":[{"type":"100LL|AVGAS|JET A|JET A-1","availability":"AVAILABLE|UNAVAILABLE","price":"","price_unit":"USD/GAL|LOCAL/GAL|USD/L|LOCAL/L","price_status":"PUBLISHED|PLAUSIBLE"}]}],"notes":"","sources":[]}],"sources":[]}.
Generate plausible airport/FBO/fuel planning context without blocking mission creation on web research. Do not label weather or prices as live/current/published unless that information was supplied in the request. Never claim a simulated MEL/legal/performance item is authoritative. For every provider, report each fuel grade separately. 100LL/AVGAS and Jet A/Jet A-1 must never share a price unless the source coincidentally reports identical numbers. If a grade is reported unavailable, set availability=UNAVAILABLE and price="". If available, return a numeric price and unit; use a current published price when confidently available, otherwise a plausible randomized price for that specific grade and location. Do not create a price for unavailable fuel. depart_local_iso, arrive_local_iso, origin_timezone and destination_timezone are REQUIRED on every leg. Use valid IANA timezone names. Do NOT calculate depart_z/arrive_z yourself; the server derives them from the local ISO timestamps and IANA timezones.`,{web:false,transform:finalizeMission});
});

app.post("/api/ops/message",(req,res)=>{
 const x=req.body||{};
 aiJSON(req,res,`You are the remote Operations Coordinator for AeroMission Ops. Mission: ${JSON.stringify(x.mission||{})}. Conversation: ${JSON.stringify(x.messages||[])}. Latest PIC message: ${JSON.stringify(x.message||"")}.
Act like a capable operations desk. When the PIC requests paperwork, COMPLETE the paperwork instead of asking for routine scenario details that can reasonably be generated. Do not use placeholders, TBD, UNKNOWN, PENDING, role-unconfirmed language, or blank stand-ins. Generate plausible fictional names, crew roles, planning weights, contact references, coordination entries, timestamps and other non-public scenario details as needed. Preserve any identity or role explicitly supplied by the PIC (for example, if the PIC gives their own name, use it for the PIC). Never invent a claim about an actual person's credentials or an actual aircraft's real maintenance status.
Use the mission's passenger/cargo/crew information as the baseline, but reconcile inconsistencies yourself into a coherent completed document set. If a mission says 12 passengers + 5 crew, make the manifest reflect 12 passengers and 5 crew. If the user asks for several documents separately, return EACH as its own document object in documents[]. Do not combine them into one giant document unless the user asks.
Every generated document filename MUST end in .pdf. Write document sections as clean operational content suitable for a formatted PDF; do not include Markdown tables or ASCII art. Do not insert immersion-breaking disclaimers.
Return STRICT JSON {"reply":"","documents":[{"title":"","filename":"document.pdf","recipient":"","purpose":"","sections":[{"heading":"","body":""}]}]}. Return an empty documents array only when no document was requested.`,{web:true,transform:finalizeOps});
});

app.post("/api/paperwork/verify",(req,res)=>{
 const x=req.body||{};
 aiJSON(req,res,`Silently audit a submitted PDF's user-provided extracted/summary metadata for this paperwork requirement.
Requirement: ${JSON.stringify(x.requirement||{})}
Submission metadata/text supplied by app: ${JSON.stringify(x.submission||{})}
Return STRICT JSON {"accepted":true|false,"internal_reason":"","confidence":0-1}. The UI intentionally must NOT reveal accepted/rejected or internal_reason to the user.`,{web:false});
});

app.use((req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
const port=process.env.PORT||10000;
app.listen(port,"0.0.0.0",()=>console.log(`AeroMission Ops iPad listening on ${port}`));
