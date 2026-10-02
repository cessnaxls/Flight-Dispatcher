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
async function aiJSON(req,res,prompt,{web=true}={}){
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
    res.json(JSON.parse(t.slice(a,b+1)));
  }catch(e){res.status(500).json({error:e.message||String(e)});}
}
app.get("/api/health",(req,res)=>res.json({ok:true,aiConfigured:!!process.env.OPENAI_API_KEY}));

app.post("/api/jobs",(req,res)=>{
 const f=req.body||{};
 aiJSON(req,res,`You are the AI operations backend for AeroMission Ops, a FLIGHT-SIMULATION app.
Return STRICT JSON {"jobs":[...]} with exactly 8 varied assignments.
The graphical app is only an interface; YOU develop the assignment, mission profile, aircraft, payload, schedule, operational texture, aircraft-appropriate maintenance context, and paperwork requirements.
Aircraft may be ANY plausible real aircraft type and are NOT restricted to the user's fleet. For every generated aircraft, use web research to select a REAL publicly documented registration/tail whose real-world aircraft type matches the generated aircraft. Never invent registrations; if no real tail can be verified, leave registration_hint blank.
Starting point filter: ${JSON.stringify(f.start||"ANYWHERE")}. Treat it as airport/city/state/province/country/region/free-form geography.
Operation filter: ${JSON.stringify(f.operation||"AI DECIDES")}; aircraft filter: ${JSON.stringify(f.aircraft||"AI DECIDES")}; distance ${f.minNm||75}-${f.maxNm||1800} NM; difficulty filter ${JSON.stringify(f.difficulty||"ALL LEVELS")}. If ALL LEVELS, deliberately mix easy, moderate, hard, and very demanding jobs.
Use web search for CURRENT weather at origin/destination and airport/FBO context. Fuel prices shown to the player must always be numeric plausible scenario prices. Use published prices when confidently available; otherwise generate a randomized plausible simulation price appropriate to region, airport and fuel type. Keep provenance internally as PLAUSIBLE SIMULATION PRICE.
Each job: id,title,operation,urgency,origin,destination,origin_name,destination_name,aircraft_type,registration_hint,registration_status,distance_nm,legs,difficulty,depart_local,arrive_local,weather_hook,weather_checked_at,payload_summary,pax_summary,mx_risk,route_character,legal_hook,story,leg_schedule[{seq,origin,destination,depart_local,arrive_local,distance_nm}].`);
});

app.post("/api/aircraft",(req,res)=>{
 const {registration="",type="",start=""}=req.body||{};
 aiJSON(req,res,`AeroMission Ops flight-simulation aircraft research.
Registration supplied: ${registration||"NONE"}. ICAO/type supplied: ${type||"NONE"}. Starting geography: ${start||"NONE"}.
If a registration is supplied, research public sources and match it to the real aircraft only when verifiable. Do not fabricate identity. If an ICAO type is supplied without a registration, find a plausible publicly documented tail consistent with the starting geography when possible; otherwise clearly mark the tail as SIMULATED.
Return STRICT JSON: {"registration":"","aircraft_type":"","display_name":"","identity_status":"VERIFIED PUBLIC MATCH|PLAUSIBLE PUBLIC MATCH|SIMULATED","operator":"","year":"","serial":"","fuel_type":"","fuel_capacity":"","weight_context":"","payload_context":"","range_context":"","runway_context":"","engine_context":"","systems_context":"","health":number,"initial_state":{"airframe_hours":number,"cycles":number,"engine_hours":number},"inspections":[{"name":"","basis":"","due_date":"","due_hours":number,"due_cycles":number,"notes":""}],"mx_domains":[],"sources":[]}.
Inspection times are simulation records randomized plausibly for aircraft category, never claimed as real maintenance history.`);
});

app.post("/api/mission",(req,res)=>{
 const x=req.body||{};
 aiJSON(req,res,`Create a detailed FLIGHT-SIMULATION mission from these controls/job:
${JSON.stringify(x)}
Payload logic is mission-specific and MUST be recalculated independently for every leg. Do not copy payload from another mission or mechanically repeat the first leg. Track loading and unloading. payload_lb must equal passenger_weight_lb + baggage_lb + cargo_lb + equipment_lb and remain plausible for the selected aircraft. If no registration was explicitly supplied, use web research to select a REAL publicly documented tail whose actual aircraft type matches aircraft_type; never invent a registration. Return STRICT JSON {"code":"","title":"","operation":"","story":"","registration":"","registration_status":"VERIFIED PUBLIC MATCH","aircraft_type":"","balance":number,"legs":[{"seq":1,"origin":"","destination":"","distance_nm":number,"depart_local":"","arrive_local":"","pax":number,"passenger_weight_lb":number,"baggage_lb":number,"cargo_lb":number,"equipment_lb":number,"payload_lb":number,"cargo_description":"","manifest_summary":"","weather_context":"","fuel_plan":"","airport_brief":""}],"open_items":[{"category":"MEL|CDL|MX|MISSION EQUIPMENT","description":"","limitation":"","source_note":"SIMULATED TRAINING ITEM"}],"paperwork":[{"doc_type":"","submit_to":"","requirement":""}],"airport_briefings":[{"icao":"","field_summary":"","runways":"","weather":"","limitations":"","customs":"","handling":"","fbos":[{"name":"","services":"","fuel_types":"","fuel_price":"","price_status":"PUBLISHED|PLAUSIBLE SIMULATION PRICE"}],"notes":"","sources":[]}],"sources":[]}.
Use web search for current weather and current public airport/FBO/fuel information. Never claim a simulated MEL/legal/performance item is authoritative. FBO fuel_price must always contain a numeric scenario price even when public pricing is unavailable.`);
});

app.post("/api/ops/message",(req,res)=>{
 const x=req.body||{};
 aiJSON(req,res,`You are the remote Operations Coordinator for AeroMission Ops, a flight-simulation dispatch desk. Mission: ${JSON.stringify(x.mission||{})}. Conversation: ${JSON.stringify(x.messages||[])}. Latest PIC message: ${JSON.stringify(x.message||"")}. Respond naturally as an operations coordinator. Help the PIC request, prepare, route, or clarify simulated paperwork. When enough information exists and the PIC requests a document, include a document object. Return STRICT JSON {"reply":"","document":null OR {"title":"","filename":"","recipient":"","purpose":"","sections":[{"heading":"","body":""}]}}. Generated paperwork is simulation-only, not real operational authority.`,{web:true});
});

app.post("/api/paperwork/verify",(req,res)=>{
 const x=req.body||{};
 aiJSON(req,res,`Silently audit a submitted PDF's user-provided extracted/summary metadata for this FLIGHT-SIMULATION paperwork requirement.
Requirement: ${JSON.stringify(x.requirement||{})}
Submission metadata/text supplied by app: ${JSON.stringify(x.submission||{})}
Return STRICT JSON {"accepted":true|false,"internal_reason":"","confidence":0-1}. The UI intentionally must NOT reveal accepted/rejected or internal_reason to the user.`,{web:false});
});

app.use((req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
const port=process.env.PORT||10000;
app.listen(port,"0.0.0.0",()=>console.log(`AeroMission Ops iPad listening on ${port}`));
