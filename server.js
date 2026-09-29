import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
app.use(express.json({limit:"3mb"}));
app.use(express.static(path.join(__dirname,"public")));

const modelAllow=new Set(["gpt-5.6-luna","gpt-5.6-terra","gpt-5.6-sol","gpt-5.6"]);
function client(req){
  const key=process.env.OPENAI_API_KEY;
  if(!key) throw new Error("OPENAI_API_KEY is not configured on Render.");
  return new OpenAI({apiKey:key});
}
async function aiJSON(req,res,prompt,{web=true}={}){
  try{
    const requested=String(req.body?.model||process.env.OPENAI_MODEL||"gpt-5.6-luna");
    const model=modelAllow.has(requested)?requested:"gpt-5.6-luna";
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
Aircraft may be ANY plausible real aircraft type and are NOT restricted to the user's fleet.
Starting point filter: ${JSON.stringify(f.start||"ANYWHERE")}. Treat it as airport/city/state/province/country/region/free-form geography.
Operation filter: ${JSON.stringify(f.operation||"AI DECIDES")}; aircraft filter: ${JSON.stringify(f.aircraft||"AI DECIDES")}; distance ${f.minNm||75}-${f.maxNm||1800} NM; difficulty ${f.difficulty||50}%.
Use web search for CURRENT weather at origin/destination and airport/FBO context. Never present invented fuel prices as published; if unavailable use a plausible SIMULATED ESTIMATE and label it.
Each job: id,title,operation,urgency,origin,destination,origin_name,destination_name,aircraft_type,registration_hint,distance_nm,legs,difficulty,depart_local,arrive_local,weather_hook,weather_checked_at,payload_summary,pax_summary,mx_risk,route_character,legal_hook,story,leg_schedule[{seq,origin,destination,depart_local,arrive_local,distance_nm}].`);
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
Return STRICT JSON {"code":"","title":"","operation":"","story":"","registration":"","aircraft_type":"","balance":number,"legs":[{"seq":1,"origin":"","destination":"","distance_nm":number,"depart_local":"","arrive_local":"","pax":number,"payload_lb":number,"cargo_description":"","manifest_summary":"","weather_context":"","fuel_plan":"","airport_brief":""}],"open_items":[{"category":"MEL|CDL|MX|MISSION EQUIPMENT","description":"","limitation":"","source_note":"SIMULATED TRAINING ITEM"}],"paperwork":[{"doc_type":"","submit_to":"","requirement":""}],"airport_briefings":[{"icao":"","field_summary":"","runways":"","weather":"","limitations":"","customs":"","handling":"","fbos":[{"name":"","services":"","fuel_types":"","fuel_price":"","price_status":"PUBLISHED|SIMULATED ESTIMATE - NOT PUBLISHED"}],"notes":"","sources":[]}],"sources":[]}.
Use web search for current weather and current public airport/FBO/fuel information. Never claim a simulated MEL/legal/performance item is authoritative.`);
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
