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
debugEvent("INFO","PATCH 34 generation engine loaded",{mode:"MISSION_FIRST_STAGED_GENERATION_AUTHORITATIVE_MERGE",primary_timeout_ms:60000,mission_fallback_ms:22000,correction_timeout_ms:12000});


async function awcText(product,icao){
 try{const u=`https://aviationweather.gov/api/data/${product}?ids=${encodeURIComponent(icao)}&format=raw`;const r=await fetch(u,{headers:{"User-Agent":"AeroMissionOps/1.0 dispatch-weather"},signal:AbortSignal.timeout(5000)});if(r.status===204)return "NO REPORT";if(!r.ok)return `UNAVAILABLE (${r.status})`;return (await r.text()).trim()||"NO REPORT"}catch(e){return "UNAVAILABLE"}
}
async function awcMetarJson(icao){try{const r=await fetch(`https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=json`,{headers:{"User-Agent":"AeroMissionOps/1.0 dispatch-weather"},signal:AbortSignal.timeout(5000)});if(!r.ok)return null;const a=await r.json();return Array.isArray(a)?a[0]||null:null}catch{return null}}
function avgWindTemp(a,b){const xs=[a,b].filter(Boolean);if(!xs.length)return "UNAVAILABLE";const dirs=xs.map(x=>Number(x.wdir)).filter(Number.isFinite),sp=xs.map(x=>Number(x.wspd)).filter(Number.isFinite),tp=xs.map(x=>Number(x.temp)).filter(Number.isFinite);const av=z=>z.length?Math.round(z.reduce((a,b)=>a+b,0)/z.length):null;return `${av(dirs)??"VRB"}°/${av(sp)??"—"}KT AVG SFC; ${av(tp)??"—"}C AVG SFC`}
async function enrichWeather(m){
 const legs=m?.legs||[];for(const l of legs){const dep=l.origin,dst=l.destination,alt=l.alternate_icao||"";const [dm,dt,am,at,dj,aj]=await Promise.all([awcText("metar",dep),awcText("taf",dep),awcText("metar",dst),awcText("taf",dst),awcMetarJson(dep),awcMetarJson(dst)]);l.weather={departure_metar:dm,departure_taf:dt,destination_metar:am,destination_taf:at};l.average_wind_temp=avgWindTemp(dj,aj);if(alt){l.weather.alternate_metar=await awcText("metar",alt);l.weather.alternate_taf=await awcText("taf",alt)}l.weather_context=`DEP METAR ${dm} | DEP TAF ${dt} | DEST METAR ${am} | DEST TAF ${at}`}
 m.weather_source="NOAA/NWS Aviation Weather Center Data API";m.weather_retrieved_at=new Date().toISOString();return m
}
app.post("/api/weather/enrich",async(req,res)=>{try{res.json(await enrichWeather(req.body?.mission||{}))}catch(e){res.status(500).json({error:e.message})}});

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
  const selectedModel=modelAllow.has(requested)?requested:"gpt-6-luna";
  const c=client(req), progressId=req.body?._generation_id||"", started=Date.now();
  const requestKind=req.path.includes("jobs")?"JOB BOARD":req.path.includes("mission")?"MISSION":req.path.includes("ops")?"OPS":"AI";
  // Jobs and missions are interactive UI actions: always use Luna with low reasoning.
  // Larger models can take long enough that the browser experience becomes unusable.
  const model=(requestKind==="JOB BOARD"||requestKind==="MISSION")?"gpt-6-luna":selectedModel;
  setGenerationProgress(progressId,8,"STARTING","Preparing AI request");
  debugEvent("START",`${requestKind} generation started`,{id:progressId,web,model,requested_model:selectedModel});
  let raw="", data, primaryError=null;
  try{
    setGenerationProgress(progressId,25,web?"AI + WEB RESEARCH":"AI GENERATION",web?"Generating while searching current public sources":"Generating structured data");
    const isInteractive=requestKind==="JOB BOARD"||requestKind==="MISSION";
    const params={model,input:`${prompt}\n\nOUTPUT CONTRACT: Return exactly ONE complete JSON object. No Markdown fences and no prose before or after the object.`,max_output_tokens:requestKind==="JOB BOARD"?6000:requestKind==="MISSION"?11000:web?12000:9000};
    if(isInteractive) params.reasoning={effort:"low"};
    if(web) params.tools=[{type:"web_search",search_context_size:"low"}];
    else params.text={format:{type:"json_object"}};
    const primaryTimeout=requestKind==="MISSION"?60000:requestKind==="JOB BOARD"?50000:(web?45000:40000);
    const r=await responseWithTimeout(c,params,primaryTimeout);
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
      const hasRaw=Boolean(raw&&raw.trim());
      const repairInput=hasRaw
        ? `Convert the following attempted response into ONE valid JSON object only. Preserve its data; do not research or add commentary.\n\n${raw}`
        : `The prior generation request timed out before returning usable text. Complete the ORIGINAL REQUEST below now. Be compact: populate every required top-level field and every leg, but keep narrative/basis strings concise. Return exactly one valid JSON object and no commentary.\n\nORIGINAL REQUEST:\n${prompt}`;
      const fallbackMs=requestKind==="MISSION"&&!hasRaw?22000:7000;
      const fallbackTokens=requestKind==="MISSION"&&!hasRaw?8000:10000;
      const r=await responseWithTimeout(c,{model,input:repairInput,text:{format:{type:"json_object"}},max_output_tokens:fallbackTokens,reasoning:{effort:"low"}},fallbackMs);
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
      const correctionTimeout=requestKind==="MISSION"?12000:7000;
      const rr=await responseWithTimeout(c,{model,input:correction,text:{format:{type:"json_object"}},max_output_tokens:10000},correctionTimeout);
      let corrected=JSON.parse(String(rr.output_text||"{}"));
      if(transform)corrected=transform(corrected);
      setGenerationProgress(progressId,100,"COMPLETE",`Completed in ${((Date.now()-started)/1000).toFixed(1)}s`);
      debugEvent("COMPLETE",`${requestKind} generation corrected and completed`,{id:progressId,elapsed_ms:Date.now()-started});
      return res.json(corrected);
    }catch(e2){
      const detail=e2?.message||validationError;
      // PATCH 32: expanded ground-support research.
      // PATCH 31: mission validation is section-tolerant. If the creative/operational
      // mission itself is usable, do not discard it because a secondary section
      // (MX, paperwork, manifest detail, etc.) failed a corrective pass. The
      // original transform mutates authoritative aircraft identity before most
      // section checks, so preserve those successful values and let downstream
      // enrichment/rendering consume the usable mission.
      if(requestKind==="MISSION" && data && typeof data==="object" && !Array.isArray(data)){
        try{
          const usableLegs=Array.isArray(data.legs)?data.legs.map(finalizeLeg).filter(l=>l.origin&&l.destination):[];
          if(String(data.title||"").trim() && String(data.registration||"").trim() && String(data.aircraft_type||"").trim() && usableLegs.length){
            data.legs=usableLegs;
            data.open_items=Array.isArray(data.open_items)?data.open_items:[];
            data.paperwork=Array.isArray(data.paperwork)?data.paperwork:[];
            data.airport_briefings=Array.isArray(data.airport_briefings)?data.airport_briefings:[];
            data._section_repair_warning=validationError;
            debugEvent("WARN","MISSION section correction timed out; preserving usable mission",{id:progressId,error:detail,initial_error:validationError,elapsed_ms:Date.now()-started});
            setGenerationProgress(progressId,100,"COMPLETE","Mission preserved; secondary section will use available data");
            return res.json(data);
          }
        }catch{}
      }
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
  if(j.leg_schedule[0]) { j.origin=j.leg_schedule[0].origin; j.depart_z=j.leg_schedule[0].depart_z; }
  if(j.leg_schedule.at(-1)) { j.destination=j.leg_schedule.at(-1).destination; j.arrive_z=j.leg_schedule.at(-1).arrive_z; }
  return j;
}
function validateZuluLegs(legs,label="generation"){
  if(!Array.isArray(legs)||!legs.length) throw new Error(`${label} returned no usable legs.`);
  const bad=legs.find(l=>!l.depart_z||!l.arrive_z);
  if(bad) throw new Error(`${label} omitted a valid local ISO time or IANA timezone for leg ${bad.seq||"?"}; retrying.`);
}
function mergeAuthoritativeMission(data,x){
  data=(data&&typeof data==="object"&&!Array.isArray(data))?data:{};
  const src=(x&&typeof x==="object")?x:{};
  const concept=(src.concept&&typeof src.concept==="object")?src.concept:{};
  const job=(src.job&&typeof src.job==="object")?src.job:{};
  // Earlier stages are authoritative. Expansion may add detail, never erase identity.
  data.title=String(concept.title||job.title||data.title||"").trim();
  data.operation=String(concept.operation||job.operation||data.operation||"").trim();
  data.story=String(concept.story||job.story||data.story||"").trim();
  data.registration=String(src.registration||src.aircraft_identity?.registration||data.registration||"").trim();
  data.aircraft_type=String(src.aircraft_identity?.aircraft_type||src.aircraft_type||concept.aircraft_type||job.aircraft_type||data.aircraft_type||"").trim();
  data.registration_status=src.aircraft_identity?.identity_status||data.registration_status||"VERIFIED PUBLIC MATCH";
  // Job-board itinerary is authoritative and is a safe structural fallback if expansion omitted legs.
  if((!Array.isArray(data.legs)||!data.legs.length) && Array.isArray(job.leg_schedule) && job.leg_schedule.length){
    data.legs=job.leg_schedule.map((l,i)=>({...l,seq:l.seq||i+1}));
  }
  data.open_items=Array.isArray(data.open_items)?data.open_items:[];
  data.paperwork=Array.isArray(data.paperwork)?data.paperwork:[];
  data.airport_briefings=Array.isArray(data.airport_briefings)?data.airport_briefings:[];
  return data;
}
function finalizeMission(data){
  const title=String(data?.title||"").trim(), story=String(data?.story||"").trim(), operation=String(data?.operation||"").trim(), aircraft=String(data?.aircraft_type||"").trim();
  if(/AM-UNASSIGNED/i.test(String(data?.code||""))||/Mission Setup Required|details are incomplete|no legs.*can be established/i.test(`${title} ${story}`)) throw new Error("Mission generator returned a setup/incomplete mission instead of a real assignment.");
  if(!title||!operation||!aircraft||!String(data?.registration||"").trim()) throw new Error("Mission generator omitted required assignment identity fields or real aircraft registration.");
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
  return data;
}
function enforceRequestedMx(data, requested){
  const band=String(requested||"RANDOM").toUpperCase();
  if(!["BAD","OK","GOOD"].includes(band)) return data;
  data.mx_profile=data.mx_profile||{};
  data.mx_profile.requested_band=band;
  const cond=String(data.mx_profile.resolved_condition||"").toUpperCase();
  const allowed=band==="BAD"?/(POOR|BAD|BELOW|DEGRADED|MARGINAL)/:band==="OK"?/(AVERAGE|OK|ORDINARY|NORMAL)/:/(GOOD|ABOVE|EXCELLENT|PRISTINE)/;
  if(!allowed.test(cond)) data.mx_profile.resolved_condition=band==="BAD"?"POOR":band==="OK"?"AVERAGE":"GOOD";
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


app.post("/api/fbo/enrich",(req,res)=>{
 const mission=req.body?.mission||{};
 const airports=[...new Set([...(mission.legs||[]).flatMap(l=>[l.origin,l.destination,l.alternate_icao].filter(Boolean)),...(mission.airport_briefings||[]).map(a=>a.icao).filter(Boolean)])];
 if(!airports.length)return res.json(mission);
 aiJSON(req,res,`Research CURRENT public ground-support and aviation-fuel information for EVERY airport in this list: ${airports.join(", ")}.

This is NOT limited to businesses calling themselves an FBO. For EACH airport, deliberately search multiple provider categories and enumerate ALL verifiable providers relevant to a flight operation:
1. fixed-base operators / executive aviation terminals / business-aviation facilities;
2. airport-appointed or airline ground handlers and ramp handlers;
3. cargo handlers when the airport or mission uses cargo operations;
4. aviation fuel suppliers, fuel concessionaires, hydrant operators and into-plane fueling companies;
5. trip-support companies that actually arrange handling/fuel at that airport (mark these as COORDINATOR rather than implying they are the on-airport handler);
6. GA terminals, VIP terminals, parking/hangar providers, deicing providers and other directly relevant aircraft-service providers.

Search using the ICAO AND airport name with terms such as FBO, ground handling, handler, business aviation, executive terminal, fuel supplier, Jet A-1, AVGAS, into-plane, hydrant, cargo handling, ramp services and trip support. Prefer current official airport/operator pages, airport operational/synopsis documents, handler/fuel-company pages, AirNav/GlobalAir/FlightAware where useful, and other reliable public aviation listings. Do not stop after finding the first provider. Cross-check airport documentation where possible because many international airports have handlers and fuel concessionaires but no US-style FBO.

For each provider capture its role/type, whether it is ON AIRPORT or a COORDINATOR, services, published contact details/hours when available, and every verified fuel grade/service combination. Keep 100LL/AVGAS and Jet A/Jet A-1 separate. Capture the published fuel price and price-update date when available. If a provider and fuel grade are verified but no current retail price is published, leave price blank; the app will insert a dispatch planning price after research. Never invent a provider, handler, fuel company, contact, fuel grade, availability, or published price.

Only return an empty fbos array after searching ALL of those categories and finding no verifiable operational provider. Explain what was searched in notes.
Return STRICT JSON {"airports":[{"icao":"","fbos":[{"name":"","provider_type":"FBO|GROUND HANDLER|CARGO HANDLER|FUEL SUPPLIER|INTO-PLANE FUEL|EXECUTIVE TERMINAL|TRIP SUPPORT|OTHER","presence":"ON AIRPORT|COORDINATOR","services":"","contact":"","hours":"","fuels":[{"type":"100LL|AVGAS|JET A|JET A-1|MOGAS|SAF","service":"FULL SERVICE|SELF SERVICE|ASSISTED|INTO-PLANE|HYDRANT|","availability":"AVAILABLE|UNAVAILABLE|NOT PUBLISHED","price":"","price_unit":"USD/GAL|LOCAL/GAL|USD/L|LOCAL/L|","price_updated":""}],"source":""}],"notes":"","sources":[""]}]}.
Only include facts supported by the public sources you found.`,{web:true,transform:data=>{
   const by=new Map((data.airports||[]).map(a=>[normalizeIcao(a.icao),a]));
   mission.airport_briefings=Array.isArray(mission.airport_briefings)?mission.airport_briefings:[];
   for(const icao of airports){let b=mission.airport_briefings.find(x=>normalizeIcao(x.icao)===icao);if(!b){b={icao,field_summary:"",runways:"",field_elevation:"",weather:"",limitations:"",customs:"",handling:"",fbos:[],notes:"",sources:[]};mission.airport_briefings.push(b)}const live=by.get(icao);b.fbos=live?.fbos||[];for(const fbo of b.fbos){for(const fuel of (fbo.fuels||[])){if(String(fuel.availability||"").toUpperCase()==="AVAILABLE"&&!String(fuel.price||"").trim()){const t=String(fuel.type||"").toUpperCase();const lo=t.includes("JET")?5.25:t.includes("MOGAS")?4.75:5.50,hi=t.includes("JET")?9.75:t.includes("MOGAS")?7.25:9.25;const n=lo+Math.random()*(hi-lo);fuel.price=`$${n.toFixed(2)}`;fuel.price_unit="USD/GAL";fuel.price_updated="DISPATCH"}}}b.fbo_notes=live?.notes||"NO VERIFIED GROUND-SUPPORT DATA RETURNED";b.fbo_sources=live?.sources||[]}
   return mission;
 }});
});

app.get("/api/health",(req,res)=>res.json({ok:true,aiConfigured:!!process.env.OPENAI_API_KEY}));

app.post("/api/jobs",(req,res)=>{
 const f=req.body||{};
 const units=(f.units||"IMPERIAL").toUpperCase();
 aiJSON(req,res,`You are the AI operations backend for AeroMission Ops.
Return STRICT JSON {"jobs":[...]} with exactly 6 varied assignments. Deliberately vary leg counts across the board from 1 to 4 legs; do not make every assignment one leg.
The graphical app is only an interface; YOU develop the assignment, mission profile, aircraft, payload, schedule, operational texture, aircraft-appropriate maintenance context, and paperwork requirements.
Aircraft may be ANY plausible real aircraft type and are NOT restricted to the user's fleet. For every generated aircraft, choose a plausible registration hint only when you are confident it matches the aircraft type from model knowledge; otherwise leave registration_hint blank. Do not delay generation for external research.
DIVERSITY KEY: ${JSON.stringify(f.seed||crypto.randomUUID())}. Use this only as a creative entropy cue; do not print it. RECENT JOBS TO AVOID REPEATING: ${JSON.stringify((f.recent_jobs||[]).slice(0,12))}. Generate materially different mission purposes, geography, route shapes, aircraft choices, customers/payloads and operational stories from those recent jobs unless the user filters force overlap. Do not merely rename a recent assignment.
Starting point filter: ${JSON.stringify(f.start||"ANYWHERE")}. Treat it as airport/city/state/province/country/region/free-form geography.
Operation filter: ${JSON.stringify(f.operation||"AI DECIDES")}; aircraft filter: ${JSON.stringify(f.aircraft||"AI DECIDES")}; distance ${f.minNm||75}-${f.maxNm||1800} NM; Display-unit preference: ${units}. difficulty filter ${JSON.stringify(f.difficulty||"ALL LEVELS")}. If ALL LEVELS, deliberately mix easy, moderate, hard, and very demanding jobs. Requested aircraft MX band: ${JSON.stringify(f.mx_status||"RANDOM")}. Age influences MX: ${f.age_influences_mx!==false}. Apply the MX model below when creating each job.
KEEP EACH JOB COMPACT. Job Board is discovery only: use one short sentence for story, weather_hook, mx_risk, route_character and legal_hook; do not generate manifests, FBOs, fuel prices, TOLD, W/B, detailed paperwork, or airport briefings here. Generate concise weather/airport context suitable for assignment discovery. Do not claim observations are live/current unless supplied in the request. ALL airport identifiers in origin, destination, and leg_schedule MUST be four-letter ICAO codes only (examples KIND, KDEN, EGLL, RJTT), never three-letter IATA codes. Return operation as a concise operation category for every job.
MX MODEL: RANDOM may span the full range. BAD means really bad through sub-average; OK means ordinary/average; GOOD means above-average through excellent. The selected band biases condition but does not make age deterministic. When age influence is enabled, aircraft age changes the probability/severity of wear, deferred items and inspection findings, but old aircraft may be excellent and new aircraft may be poor. Location influences condition through concrete environmental/operational factors such as salt/coastal exposure, humidity, desert dust, extreme cold/heat, outdoor storage, utilization tempo, remote maintenance access and parts/logistics; never treat a country/region itself as a quality score. Return mx_status and a concise mx_risk rationale.
Each job: id,title,operation,urgency,origin,destination,origin_name,destination_name,aircraft_type,registration_hint,registration_status,distance_nm,legs,difficulty,depart_local,arrive_local,weather_hook,weather_checked_at,payload_summary,pax_summary,mx_risk,route_character,legal_hook,story,leg_schedule[{seq,origin,destination,depart_local,arrive_local,depart_local_iso:"YYYY-MM-DDTHH:MM",arrive_local_iso:"YYYY-MM-DDTHH:MM",origin_timezone:"IANA timezone",destination_timezone:"IANA timezone",distance_nm}]. depart_local_iso, arrive_local_iso, origin_timezone and destination_timezone are REQUIRED for every leg. Use valid IANA timezone names such as America/Denver. Do NOT calculate Zulu yourself; the server calculates it from local ISO + IANA timezone.`,{web:false,transform:data=>{const jobs=(data.jobs||[]).map(j=>{j=finalizeJob(j);j.mx_status=j.mx_status||f.mx_status||"RANDOM";j.age_influences_mx=f.age_influences_mx!==false;return j}).filter(j=>j.origin&&j.destination);if(jobs.length!==6)throw new Error(`Job Board returned ${jobs.length} usable jobs instead of 6.`);for(const j of jobs)validateZuluLegs(j.leg_schedule,`Job ${j.id||j.title||"?"}`);return {jobs}}});
});


app.post("/api/mission/concept",(req,res)=>{
 const x=req.body||{};
 const units=(x.units||"IMPERIAL").toUpperCase();
 aiJSON(req,res,`You are the creative assignment engine for AeroMission Ops. Invent ONE complete, coherent aviation assignment concept from the user's explicit controls. This is the creative pass only: decide the mission first, then an appropriate aircraft TYPE for that mission. Do NOT choose or research a registration/tail number, FBO, fuel price, weather observation, MEL item, TOLD value, W/B number, or dispatch calculation.
Blank controls and AI DECIDES mean genuine open choice. Do not default to a Cessna 172, piston single, survey mission, California, or any other familiar pattern. There is no preferred aircraft class, geography, customer, mission purpose, route topology, or number of legs. Let the operational need drive the aircraft choice. Aircraft can range across the real civil aviation world when appropriate.
Explicit controls: operation=${JSON.stringify(x.operation||"AI DECIDES")}; aircraft/type=${JSON.stringify(x.aircraft_type||"AI DECIDES")}; starting geography=${JSON.stringify(x.start||"ANYWHERE")}; requested legs=${JSON.stringify(x.legs||"AI DECIDES")}; difficulty=${JSON.stringify(x.grit||"AI DECIDES")}; display units=${units}.
RECENT MISSIONS ARE EXCLUSION CONTEXT ONLY: ${JSON.stringify((x.recent_missions||[]).slice(0,8))}. If controls permit, make the new concept materially different in purpose, geography, aircraft class/type, customer, payload/passenger need, route shape, schedule, and operational challenge. Never merely rename a recent mission.
Return STRICT JSON only: {"title":"","operation":"","story":"","customer_need":"","aircraft_type":"","aircraft_rationale":"","start":"","legs":number,"route_concept":"","payload_concept":"","pax_concept":"","schedule_concept":"","operational_challenges":[""]}. Keep it compact but specific enough for a later dispatch-planning pass. All airport identifiers mentioned must be four-letter ICAO codes.`,{web:false});
});

app.post("/api/aircraft",(req,res)=>{
 const {registration="",type="",start=""}=req.body||{};
 aiJSON(req,res,`AeroMission Ops aircraft research.
Registration supplied: ${registration||"NONE"}. ICAO/type supplied: ${type||"NONE"}. Starting geography: ${start||"NONE"}.
If a registration is supplied, research public sources and match it to the real aircraft only when verifiable. Do not fabricate identity. If an ICAO/type is supplied without a registration, use public web sources to find an ACTUAL publicly documented aircraft registration whose exact make/model/type matches. If neither type nor registration is supplied, return UNRESOLVED; mission conception must select the aircraft type before registration research. Never invent a registration. Prefer an FAA Registry match for U.S. N-numbers. identity_status is VERIFIED PUBLIC MATCH only when a public source supports the exact registration/type match. Otherwise return registration blank and identity_status UNRESOLVED.
Return STRICT JSON: {"registration":"","aircraft_type":"","display_name":"","identity_status":"VERIFIED PUBLIC MATCH|UNRESOLVED","operator":"","year":"","serial":"","fuel_type":"","fuel_capacity":"","weight_context":"","payload_context":"","range_context":"","runway_context":"","engine_context":"","systems_context":"","health":number,"initial_state":{"airframe_hours":number,"cycles":number,"engine_hours":number},"inspections":[{"name":"","basis":"","due_date":"","due_hours":number,"due_cycles":number,"notes":""}],"mx_domains":[],"sources":[]}.
Inspection times are generated app records randomized plausibly for aircraft category and are not claims about the real aircraft maintenance history.`);
});

app.post("/api/mission",(req,res)=>{
 const x=req.body||{};
 const units=(x.units||"IMPERIAL").toUpperCase();
 // Give each mission a real maintenance-event roll. This is not a canned discrepancy list:
 // it only decides how much lived-in MX state the AI must originate for this mission.
 const requestedMx=String(x.mx_status||x.job?.mx_status||"RANDOM").toUpperCase();
 const mxRoll=Math.random();
 let mxDirective;
 if(requestedMx==="BAD") mxDirective={required:true,min:2,max:4,preflight:mxRoll<0.55};
 else if(requestedMx==="OK") mxDirective={required:mxRoll<0.65,min:1,max:mxRoll<0.18?2:1,preflight:mxRoll<0.28};
 else if(requestedMx==="GOOD") mxDirective={required:mxRoll<0.28,min:1,max:1,preflight:mxRoll<0.10};
 else {
   const tier=mxRoll<0.18?"BAD":mxRoll<0.58?"OK":mxRoll<0.88?"GOOD":"PRISTINE";
   mxDirective=tier==="BAD"?{required:true,min:2,max:3,preflight:true}:tier==="OK"?{required:true,min:1,max:2,preflight:mxRoll<0.38}:tier==="GOOD"?{required:true,min:1,max:1,preflight:false}:{required:false,min:0,max:0,preflight:false};
 }
 aiJSON(req,res,`Create a detailed AeroMission Ops mission from these controls/job. IMPORTANT: blank/empty user controls mean AI DECIDES; they are NEVER missing requirements. You MUST invent a complete operation, aircraft, route, schedule, manifests and mission when controls are blank. Never return AM-UNASSIGNED, Mission Setup Required, or an incomplete/setup-required mission. USER DISPLAY UNITS: ${units}. If IMPERIAL, ALL generated/displayed lengths, runway dimensions, elevations, weights, fuel quantities, temperatures and performance figures must use imperial aviation units (ft, lb, gal where appropriate, deg F). If METRIC, use m, kg, L and deg C. Do not mix systems except when a source quote is unavoidable. Return local wall-clock times plus IANA timezones; the server will CALCULATE UTC/Zulu times. ALL airport identifiers MUST be four-letter ICAO codes only, never IATA codes:
${JSON.stringify(x)}
MISSION CONCEPT / JOB IS AUTHORITATIVE: ${JSON.stringify(x.concept||x.job||{})}. This is the operational-expansion pass, NOT a second creative lottery. Preserve the established mission purpose, geography, aircraft type, customer need, route concept and story while expanding it into detailed legs, manifests, MX state and dispatch planning. Do not substitute a different aircraft type or reinvent the assignment.
MX CONDITION MODEL: Requested MX band is ${JSON.stringify(x.mx_status||x.job?.mx_status||"RANDOM")}; age influence is ${(x.age_influences_mx ?? x.job?.age_influences_mx)!==false}. RANDOM may span the full range.
THIS MISSION'S MX EVENT DIRECTIVE: ${JSON.stringify(mxDirective)}. This directive is authoritative. If required=true, open_items MUST contain between min and max genuinely specific MEL/CDL/INOP discrepancies. If preflight=true, at least one must have status FOUND DURING PREFLIGHT. If required=false, a clean aircraft is allowed. Do not reuse a stock defect pattern merely to satisfy this; originate discrepancies that fit this exact aircraft type, equipment, mission, age/exposure context and operational regime. Prefer characterful but operationally credible nuisance/deferred defects (lights, indications, cabin/galley equipment, anti-ice components, autopilot/avionics functions, doors/seals, etc.) when appropriate rather than making every imperfect aircraft unsafe. A grounding defect may occur when warranted, but do not make grounding the default.
RANDOM may span the full range. BAD = really bad through sub-average; OK = average; GOOD = above-average through excellent. The requested MX band is a HARD continuity constraint when it is BAD, OK, or GOOD: the final mission must remain in that same band and must not silently improve or worsen it. BAD must resolve to poor/bad/below-average/degraded/marginal; OK to average/ordinary; GOOD to good/above-average/excellent. Use the band to control the number and severity of MEL/CDL/MX/INOP items. Age is an influence, not destiny: an old aircraft can be meticulously maintained or awful; a new aircraft can be neglected or pristine. Location also influences condition only through concrete exposure/operations factors such as salt air/corrosion, humidity, desert dust, cold/heat cycling, outdoor storage, high utilization, remote maintenance access, and parts/logistics. Do not use nationality/region as a maintenance-quality proxy. Keep outcomes varied and plausible. Generated MX condition is internal app state and must never be represented as the actual maintenance history or airworthiness status of the publicly matched registration. When aircraft_identity is present, use its real manufacture year/type/engine context as inputs to the MX simulation (especially age influence), while keeping all generated condition/findings separate from actual aircraft records. Do not put simulation/training disclaimers in mission story, MX descriptions, limitations, airport briefs, or paperwork text. Do not use the words simulation, training, scenario, fictional, placeholder, TBD, or unverified in any user-visible mission field unless the user explicitly asks for that terminology.
CREW DEFAULTS: ${JSON.stringify(x.crew_defaults||{})}. If crew_defaults.pic is nonblank, that exact name MUST be the PIC on every leg. If crew_defaults.sic is nonblank, that exact name MUST be the SIC on every leg.
DISPATCH PACKAGE: For EVERY leg, generate dispatch-issued planning data for a fuel release, TOLD report, and weight-and-balance clearance. Use the supplied/generated weather_context, airport/runway information, aircraft identity/performance context, payload and route. Never invent AFM/POH-certified numbers: when exact performance data are unavailable, performance_basis must clearly say the figures are dispatch planning estimates requiring verification against the approved AFM/POH/performance system before flight. fuel_release must break out taxi, trip, contingency, alternate, reserve, extra, minimum departure and planned landing fuel, with a concise basis. told must include runway, runway condition, wind, OAT, altimeter/QNH, takeoff/landing weights, applicable V-speeds when available, takeoff distance, landing distance and basis. wb_clearance must include ZFW, TOW, landing weight, CG, CG limits, CLR/REVIEW status and basis. Only dispatch-issued material belongs in the generated dispatch PDF; do not request the pilot to upload paperwork to complete the mission. Generate a complete paperwork index sized to the mission; long/multi-leg/international missions may legitimately require many entries. For each leg determine whether an alternate is required under the operation assumptions and return alternate_required and alternate_icao. Include a cost-effective cruise altitude appropriate to aircraft, direction, distance, expected winds/temperatures and fuel/time tradeoff. Return cruise_altitude per leg and a mission cruise_plan summary. Weather will be replaced/enriched from the NOAA/NWS Aviation Weather Center Data API after generation; never fabricate a METAR or TAF.
Payload logic is mission-specific and MUST be recalculated independently for every leg. Do not copy payload from another mission or mechanically repeat the first leg. Track loading and unloading. payload_lb must equal passenger_weight_lb + baggage_lb + cargo_lb + equipment_lb and remain plausible for the selected aircraft. A real aircraft identity is resolved before this mission request. Use aircraft_identity and the supplied registration as authoritative identity inputs for the generated mission. The mission registration MUST exactly equal the supplied real registration, and aircraft_type MUST remain consistent with aircraft_identity. Do not invent, replace, or silently alter the registration. Do not substitute a nearby subtype or family variant. When an exact public match is found, do not clutter the mission story with identity-verification commentary; place identity state only in registration_status. For EVERY leg, return a complete passenger, crew, and cargo manifest. passengers must contain PASSENGERS ONLY, never flight crew. crew must be a separate array with role, full_name and weight_lb. pax must equal passengers.length; crew_count must equal crew.length. If the mission narrative calls for 12 VIPs plus 5 crew, return 12 passengers and 5 crew, not 17 passengers. Passenger entries need full_name, weight_lb, dob (YYYY-MM-DD), and, when that leg crosses an international border, passport_country (ISO 3166-1 alpha-3 three-letter code) and passport_number. Crew identities may be fictional unless the user supplied a name/role. For domestic legs, passport fields may be blank. Use fictional identities for generated people and never copy personal data from public sources. passenger_weight_lb must equal the sum of passenger weight_lb values. cargo_manifest must list every cargo item with description, quantity, weight_lb, hazmat boolean, and when hazmat=true include simulated un_number, proper_shipping_name, hazard_class, packing_group, and handling_notes. cargo_lb must equal the sum of cargo_manifest item weights. Do not hide cargo in generic manifest_summary text. If there is no cargo return an empty array.
For maintenance, open_items is NOT a general condition narrative. Follow THIS MISSION'S MX EVENT DIRECTIVE above. When it requires discrepancies, actually populate open_items with the required count; do not return a clean airplane. When it permits a clean airplane, an empty open_items array is valid. Do not create generic MX, MONITOR, inspection reminders, condition summaries, or mission-equipment items in open_items. An item may be discovered as status "FOUND DURING PREFLIGHT". Each item must identify MEL/CDL/INOP disposition, an applicable reference/section when known, concrete operational limitations, and pic_simulation: a concise cockpit action telling the PIC how to represent the inoperative component in the flight simulator (for example leave a switch OFF, do not use the affected system, or treat an indication as unavailable). The PIC simulation action must never instruct the user to damage, disable, pull breakers on, or physically alter a real aircraft. If the discrepancy cannot legally be deferred under the applicable MEL/CDL framework, identify it as grounding in the limitation and do not imply dispatch is legal. These are generated mission-state discrepancies, not claims about the real registered aircraft's actual maintenance history.
Return STRICT JSON {"code":"","title":"","operation":"","story":"","registration":"","registration_status":"VERIFIED PUBLIC MATCH","aircraft_type":"","balance":number,"cruise_plan":{"recommended_altitude":"","basis":""},"mx_profile":{"requested_band":"RANDOM|BAD|OK|GOOD","resolved_condition":"","age_influence":true,"location_factors":[""],"summary":""},"legs":[{"seq":1,"origin":"","destination":"","distance_nm":number,"depart_local":"","arrive_local":"","depart_local_iso":"YYYY-MM-DDTHH:MM","arrive_local_iso":"YYYY-MM-DDTHH:MM","origin_timezone":"IANA timezone","destination_timezone":"IANA timezone","international":false,"alternate_required":false,"alternate_icao":"","cruise_altitude":"","average_wind_temp":"","pax":number,"passengers":[{"full_name":"","weight_lb":number,"dob":"YYYY-MM-DD","passport_country":"","passport_number":""}],"crew_count":number,"crew":[{"role":"PIC|SIC|CABIN CREW|MISSION CREW","full_name":"","weight_lb":number}],"passenger_weight_lb":number,"baggage_lb":number,"cargo_lb":number,"cargo_manifest":[{"description":"","quantity":number,"weight_lb":number,"hazmat":false,"un_number":"","proper_shipping_name":"","hazard_class":"","packing_group":"","handling_notes":""}],"equipment_lb":number,"payload_lb":number,"cargo_description":"","manifest_summary":"","weather_context":"","fuel_plan":"","fuel_release":{"release_fuel":"","taxi_fuel":"","trip_fuel":"","contingency_fuel":"","alternate_fuel":"","reserve_fuel":"","extra_fuel":"","min_departure_fuel":"","planned_landing_fuel":"","fuel_basis":""},"told":{"runway":"","runway_condition":"","wind":"","oat":"","qnh_altimeter":"","takeoff_weight":"","landing_weight":"","v1":"","vr":"","v2":"","takeoff_distance":"","landing_distance":"","performance_basis":""},"wb_clearance":{"zero_fuel_weight":"","takeoff_weight":"","landing_weight":"","cg":"","cg_limits":"","status":"CLR|REVIEW","basis":""},"airport_brief":""}],"open_items":[{"category":"MEL|CDL|INOP","status":"OPEN|FOUND DURING PREFLIGHT","description":"","disposition":"MEL|CDL|INOP","reference":"","limitation":"","pic_simulation":"","source_note":""}],"paperwork":[{"doc_type":"","submit_to":"","requirement":""}],"airport_briefings":[{"icao":"","field_summary":"","runways":"","field_elevation":"","weather":"","limitations":"","customs":"","handling":"","fbos":[{"name":"","services":"","fuels":[{"type":"100LL|AVGAS|JET A|JET A-1","availability":"AVAILABLE|UNAVAILABLE","price":"","price_unit":"USD/GAL|LOCAL/GAL|USD/L|LOCAL/L","price_status":"PUBLISHED","price_updated":""}]}],"notes":"","sources":[]}],"sources":[]}.
Do not invent FBO names or fuel prices in this generation step. Leave airport_briefings[].fbos empty; a separate live public-data enrichment step supplies real FBOs and published fuel prices. Never claim a generated MEL/legal/performance item is an actual maintenance record. depart_local_iso, arrive_local_iso, origin_timezone and destination_timezone are REQUIRED on every leg. Use valid IANA timezone names. Do NOT calculate depart_z/arrive_z yourself; the server derives them from the local ISO timestamps and IANA timezones.`,{web:false,transform:data=>{data=mergeAuthoritativeMission(data,x);const out=enforceRequestedMx(finalizeMission(data),x.mx_status||x.job?.mx_status||"RANDOM");
 const mx=(out.open_items||[]).filter(i=>["MEL","CDL","INOP"].includes(String(i.category||i.disposition||"").toUpperCase()));
 if(mxDirective.required && mx.length<mxDirective.min) throw new Error(`MX event directive required at least ${mxDirective.min} open MEL/CDL/INOP item(s), but the mission returned ${mx.length}.`);
 if(mxDirective.required && mx.length>mxDirective.max) out.open_items=out.open_items.filter(i=>!["MEL","CDL","INOP"].includes(String(i.category||i.disposition||"").toUpperCase())).concat(mx.slice(0,mxDirective.max));
 if(mxDirective.preflight && !mx.some(i=>String(i.status||"").toUpperCase()==="FOUND DURING PREFLIGHT")) throw new Error("MX event directive required a FOUND DURING PREFLIGHT discrepancy.");
 return out}});
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
