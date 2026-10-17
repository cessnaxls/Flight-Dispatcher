import {arr,obj,str} from './domain.js';

// Explicitly identify discrepancies instead of allowing an AI narrative to imply
// that a numerical flight release or registry match has been validated.
export function auditMission(m){
 const issues=[],legs=arr(m?.legs),aircraft=obj(m?.aircraft),passengers=arr(m?.passengers),crew=arr(m?.crew);
 const add=(kind,message)=>issues.push({kind,message});
 if(!legs.length)add('ROUTE','No usable flight legs');
 if(aircraft.registration_status==='CONFLICT')add('AIRCRAFT','Registration conflicts with planned aircraft type; correct the aircraft identity');
 if(!aircraft.registration||!['VERIFIED'].includes(aircraft.registration_status))add('AIRCRAFT','Registration has not been verified as matching the mission aircraft');
 for(let i=0;i<legs.length;i++){
  const leg=legs[i],n=i+1,f=obj(leg.fuel_release),w=obj(leg.weight_balance),payload=obj(leg.payload);
  if(i&&legs[i-1].destination!==leg.origin)add('ROUTE',`Leg ${n} does not connect to leg ${n-1}`);
  if(leg.alternate_icao===leg.destination)add('ALTERNATE',`Leg ${n} alternate equals destination`);
  if(leg.departure_utc&&leg.arrival_utc&&Date.parse(leg.arrival_utc)<=Date.parse(leg.departure_utc))add('SCHEDULE',`Leg ${n} arrival is not after departure`);
  if(i&&legs[i-1].arrival_utc&&leg.departure_utc&&Date.parse(leg.departure_utc)<Date.parse(legs[i-1].arrival_utc))add('SCHEDULE',`Leg ${n} starts before the preceding flight arrives`);
  const count=Number(payload.pax);if(Number.isFinite(count)&&count>crew.length+passengers.length)add('MANIFEST',`Leg ${n} payload passenger count ${count} exceeds ${crew.length} crew + ${passengers.length} manifest persons`);
  const trip=Number(f.trip_fuel_lb),taxi=Number(f.taxi_fuel_lb),alternate=Number(f.alternate_fuel_lb),reserve=Number(f.reserve_fuel_lb),block=Number(f.block_fuel_lb);
  if([trip,taxi,alternate,reserve,block].every(Number.isFinite)&&Math.abs(block-(trip+taxi+alternate+reserve))>10)add('FUEL',`Leg ${n} block fuel does not match its components`);
  const bow=Number(w.basic_operating_weight_lb),pl=Number(w.payload_lb),fuel=Number(w.fuel_lb),ramp=Number(w.ramp_weight_lb);
  if([bow,pl,fuel,ramp].every(Number.isFinite)&&Math.abs(ramp-(bow+pl+fuel))>25)add('WEIGHT',`Leg ${n} ramp weight does not match BOW + payload + fuel`);
 }
 if(m?.research?.status!=='COMPLETE')add('RESEARCH',`Airport research status ${str(m?.research?.status)||'UNKNOWN'}; findings are not a complete briefing`);
 for(const a of arr(m?.airport_briefings))if(a.status!=='RESEARCHED')add('AIRPORT',`${a.icao}: airport briefing ${a.status||'PENDING'}`);
 return issues;
}
