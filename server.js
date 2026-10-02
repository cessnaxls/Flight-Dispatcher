import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
app.use(express.json({limit:"3mb"}));
app.use(express.static(path.join(__dirname,"public")));

const modelAllow=new Set(["gpt-6-luna","gpt-6-sol","gpt-6-astra","gpt-5.6-sol"]);
function client(req){
  const key=process.env.OPENAI_API_KEY;
  if(!key) throw new Error("OPENAI_API_KEY is not configured on Render.");
  return new OpenAI({apiKey:key});
}
async function aiJSON(req,res,prompt,{web=true,transform=null}={}){
  try{
    const requested=String(req.body?.model||process.env.OPENAI_MODEL||"gpt-6-luna");
    const model=modelAllow.has(requested)?requested:"gpt-6-luna";
    const r=await client(req).responses.create({
      model,
      tools:web?[{type:"web_search"}]:[],
      input:prompt
    });
    let t=(r.output_text||"").trim().replace(/^```(?:json)?\s*|\s*```$/gis,"");
    const a=t.indexOf("{"), b=t.lastIndexOf("}");
    if(a<0||b<a) throw new Error("AI did not return JSON.");
    let data=JSON.parse(t.slice(a,b+1)); if(transform) data=transform(data); res.json(data);
  }catch(e){res.status(500).json({error:e.message||String(e)});}
}
function zonedLocalToZulu(localIso, timeZone){
  // Convert an AI-supplied wall-clock ISO time + IANA timezone into UTC.
  // Iterate the Intl offset so DST and non-whole-hour zones are handled by the runtime.
  if(!localIso || !timeZone) return "";
  const m=String(localIso).match(/^(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2})/);
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
Use web search for CURRENT weather at origin/destination and airport/FBO context. ALL airport identifiers in origin, destination, and leg_schedule MUST be four-letter ICAO codes only (examples KIND, KDEN, EGLL, RJTT), never three-letter IATA codes. Return operation as a concise operation category for every job. Fuel availability and pricing are grade-specific. Treat 100LL/AVGAS and Jet A/Jet A-1 as separate products with separate availability and separate prices. Never use one price for both. If a grade is unavailable, return UNAVAILABLE and no price. If available but a current public price cannot be verified, generate a plausible randomized numeric price appropriate to that grade, airport and region.
MX MODEL: RANDOM may span the full range. BAD means really bad through sub-average; OK means ordinary/average; GOOD means above-average through excellent. The selected band biases condition but does not make age deterministic. When age influence is enabled, aircraft age changes the probability/severity of wear, deferred items and inspection findings, but old aircraft may be excellent and new aircraft may be poor. Location influences condition through concrete environmental/operational factors such as salt/coastal exposure, humidity, desert dust, extreme cold/heat, outdoor storage, utilization tempo, remote maintenance access and parts/logistics; never treat a country/region itself as a quality score. Return mx_status and a concise mx_risk rationale.
Each job: id,title,operation,urgency,origin,destination,origin_name,destination_name,aircraft_type,registration_hint,registration_status,distance_nm,legs,difficulty,depart_local,arrive_local,weather_hook,weather_checked_at,payload_summary,pax_summary,mx_risk,route_character,legal_hook,story,leg_schedule[{seq,origin,destination,depart_local,arrive_local,depart_local_iso:"YYYY-MM-DDTHH:MM",arrive_local_iso:"YYYY-MM-DDTHH:MM",origin_timezone:"IANA timezone",destination_timezone:"IANA timezone",distance_nm}]. Do NOT calculate Zulu yourself; the server calculates it from local ISO + IANA timezone.`,{transform:data=>({jobs:(data.jobs||[]).map(j=>{j=finalizeJob(j);j.mx_status=j.mx_status||f.mx_status||"RANDOM";j.age_influences_mx=f.age_influences_mx!==false;return j}).filter(j=>j.origin&&j.destination)})});
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
 aiJSON(req,res,`Create a detailed AeroMission Ops mission from these controls/job. USER DISPLAY UNITS: ${units}. If IMPERIAL, ALL generated/displayed lengths, runway dimensions, elevations, weights, fuel quantities, temperatures and performance figures must use imperial aviation units (ft, lb, gal where appropriate, deg F). If METRIC, use m, kg, L and deg C. Do not mix systems except when a source quote is unavoidable. Return local wall-clock times plus IANA timezones; the server will CALCULATE UTC/Zulu times. ALL airport identifiers MUST be four-letter ICAO codes only, never IATA codes:
${JSON.stringify(x)}
MX CONDITION MODEL: Requested MX band is ${JSON.stringify(x.mx_status||x.job?.mx_status||"RANDOM")}; age influence is ${(x.age_influences_mx ?? x.job?.age_influences_mx)!==false}. RANDOM may span the full range. BAD = really bad through sub-average; OK = average; GOOD = above-average through excellent. Use the band to control the number and severity of MEL/CDL/MX/INOP items. Age is an influence, not destiny: an old aircraft can be meticulously maintained or awful; a new aircraft can be neglected or pristine. Location also influences condition only through concrete exposure/operations factors such as salt air/corrosion, humidity, desert dust, cold/heat cycling, outdoor storage, high utilization, remote maintenance access, and parts/logistics. Do not use nationality/region as a maintenance-quality proxy. Keep outcomes varied and plausible. Generated MX condition is scenario state for the app and must never be represented as the actual maintenance history or airworthiness status of the publicly matched registration. Do not put simulation/training disclaimers in mission story, MX descriptions, limitations, airport briefs, or paperwork text.
Payload logic is mission-specific and MUST be recalculated independently for every leg. Do not copy payload from another mission or mechanically repeat the first leg. Track loading and unloading. payload_lb must equal passenger_weight_lb + baggage_lb + cargo_lb + equipment_lb and remain plausible for the selected aircraft. If no registration was explicitly supplied, use web research to select a REAL publicly documented tail whose actual aircraft type matches aircraft_type; never invent a registration. For EVERY leg, return a complete passenger and cargo manifest. passengers must be an array of individual people with full_name, weight_lb, dob (YYYY-MM-DD), and, when that leg crosses an international border, passport_country (ISO 3166-1 alpha-3 three-letter code) and passport_number. For domestic legs, passport fields may be blank. Use fictional passenger identities and fictional passport numbers for simulation; never use real persons' personal data. pax must equal passengers.length and passenger_weight_lb must equal the sum of passenger weight_lb values. cargo_manifest must list every cargo item with description, quantity, weight_lb, hazmat boolean, and when hazmat=true include simulated un_number, proper_shipping_name, hazard_class, packing_group, and handling_notes. cargo_lb must equal the sum of cargo_manifest item weights. Do not hide cargo in generic manifest_summary text. If there is no cargo return an empty array.
Return STRICT JSON {"code":"","title":"","operation":"","story":"","registration":"","registration_status":"VERIFIED PUBLIC MATCH","aircraft_type":"","balance":number,"mx_profile":{"requested_band":"RANDOM|BAD|OK|GOOD","resolved_condition":"","age_influence":true,"location_factors":[""],"summary":""},"legs":[{"seq":1,"origin":"","destination":"","distance_nm":number,"depart_local":"","arrive_local":"","depart_local_iso":"YYYY-MM-DDTHH:MM","arrive_local_iso":"YYYY-MM-DDTHH:MM","origin_timezone":"IANA timezone","destination_timezone":"IANA timezone","international":false,"pax":number,"passengers":[{"full_name":"","weight_lb":number,"dob":"YYYY-MM-DD","passport_country":"","passport_number":""}],"passenger_weight_lb":number,"baggage_lb":number,"cargo_lb":number,"cargo_manifest":[{"description":"","quantity":number,"weight_lb":number,"hazmat":false,"un_number":"","proper_shipping_name":"","hazard_class":"","packing_group":"","handling_notes":""}],"equipment_lb":number,"payload_lb":number,"cargo_description":"","manifest_summary":"","weather_context":"","fuel_plan":"","airport_brief":""}],"open_items":[{"category":"MEL|CDL|MX|MISSION EQUIPMENT","description":"","limitation":"","source_note":""}],"paperwork":[{"doc_type":"","submit_to":"","requirement":""}],"airport_briefings":[{"icao":"","field_summary":"","runways":"","field_elevation":"","weather":"","limitations":"","customs":"","handling":"","fbos":[{"name":"","services":"","fuels":[{"type":"100LL|AVGAS|JET A|JET A-1","availability":"AVAILABLE|UNAVAILABLE","price":"","price_unit":"USD/GAL|LOCAL/GAL|USD/L|LOCAL/L","price_status":"PUBLISHED|PLAUSIBLE"}]}],"notes":"","sources":[]}],"sources":[]}.
Use web search for current weather and current public airport/FBO/fuel information. Never claim a simulated MEL/legal/performance item is authoritative. For every provider, report each fuel grade separately. 100LL/AVGAS and Jet A/Jet A-1 must never share a price unless the source coincidentally reports identical numbers. If a grade is reported unavailable, set availability=UNAVAILABLE and price="". If available, return a numeric price and unit; use a current published price when confidently available, otherwise a plausible randomized price for that specific grade and location. Do not create a price for unavailable fuel. Do NOT calculate depart_z/arrive_z yourself; the server derives them from the local ISO timestamps and IANA timezones.`,{transform:data=>{data.legs=(data.legs||[]).map(finalizeLeg).filter(l=>l.origin&&l.destination); return data;}});
});

app.post("/api/ops/message",(req,res)=>{
 const x=req.body||{};
 aiJSON(req,res,`You are the remote Operations Coordinator for AeroMission Ops, a operations dispatch desk. Mission: ${JSON.stringify(x.mission||{})}. Conversation: ${JSON.stringify(x.messages||[])}. Latest PIC message: ${JSON.stringify(x.message||"")}. Respond naturally as an operations coordinator. Help the PIC request, prepare, route, or clarify mission paperwork. When enough information exists and the PIC requests a document, include a document object. Return STRICT JSON {"reply":"","document":null OR {"title":"","filename":"","recipient":"","purpose":"","sections":[{"heading":"","body":""}]}}. Do not insert immersion-breaking disclaimers into the document body.`,{web:true});
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
