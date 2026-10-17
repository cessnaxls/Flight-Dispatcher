const URL='https://data.vatsim.net/v3/vatsim-data.json';
let cache=null;let pending=null;
export function validCID(cid){return /^\d{5,9}$/.test(String(cid||''));}
export function summarizePilot(p){if(!p)return null;const f=p.flight_plan||{};return {cid:p.cid,callsign:p.callsign||null,latitude:p.latitude??null,longitude:p.longitude??null,altitude:p.altitude??null,groundspeed:p.groundspeed??null,heading:p.heading??null,logon_time:p.logon_time||null,last_updated:p.last_updated||null,flight_plan:{departure:f.departure||null,arrival:f.arrival||null,alternate:f.alternate||null,aircraft:f.aircraft||null,aircraft_short:f.aircraft_short||null,route:f.route||null,flight_rules:f.flight_rules||null,deptime:f.deptime||null,enroute_time:f.enroute_time||null}}}
export async function vatsimLive(cid,{fetcher=fetch,now=Date.now}={}){
 if(!validCID(cid))throw Object.assign(new Error('Set a valid 5–9 digit VATSIM CID in Settings'),{status:400});
 const at=now();if(cache&&at-cache.at<15000){const pilot=cache.pilots.find(p=>String(p.cid)===String(cid));return {status:pilot?'ONLINE':'OFFLINE',pilot:summarizePilot(pilot),feed_timestamp:cache.feed_timestamp,source:URL}}
 if(!pending){pending=(async()=>{const r=await fetcher(URL,{signal:AbortSignal.timeout(16000),headers:{'Accept':'application/json','User-Agent':'AeroMissionOps-3-Simulation'}});if(!r.ok)throw Error(`VATSIM feed HTTP ${r.status}`);const d=await r.json();if(!Array.isArray(d.pilots))throw Error('VATSIM feed lacks pilots');cache={pilots:d.pilots,feed_timestamp:d.general?.update_timestamp||new Date(now()).toISOString(),at:now()};return cache})();}try{await pending}finally{pending=null}
 const pilot=cache.pilots.find(p=>String(p.cid)===String(cid));return {status:pilot?'ONLINE':'OFFLINE',pilot:summarizePilot(pilot),feed_timestamp:cache.feed_timestamp,source:URL};
}
