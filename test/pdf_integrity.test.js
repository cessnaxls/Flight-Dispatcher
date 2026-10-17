import test from 'node:test';import assert from 'node:assert/strict';import {auditMission} from '../audit.js';
test('flags mismatched aircraft and pending airport enrichment rather than claiming complete dispatch',()=>{
 const m={aircraft:{registration:'N650AM',registration_status:'CONFLICT'},research:{status:'QUEUED'},legs:[{origin:'KSEA',destination:'PANC',alternate_icao:'PAFA',fuel_release:{trip_fuel_lb:1000,taxi_fuel_lb:50,alternate_fuel_lb:300,reserve_fuel_lb:500,block_fuel_lb:900},weight_balance:{basic_operating_weight_lb:24000,payload_lb:400,fuel_lb:5000,ramp_weight_lb:35000}}],airport_briefings:[{icao:'KSEA',status:'PENDING'}]};
 const issues=auditMission(m);assert.ok(issues.some(x=>x.kind==='AIRCRAFT'));assert.ok(issues.some(x=>x.kind==='RESEARCH'));assert.ok(issues.some(x=>x.kind==='FUEL'));assert.ok(issues.some(x=>x.kind==='WEIGHT'));assert.ok(issues.some(x=>x.kind==='AIRPORT'));
});
test('clean mock mission has no integrity warnings',()=>{
 const m={aircraft:{registration:'N12345',registration_status:'VERIFIED'},research:{status:'COMPLETE'},crew:[],passengers:[],legs:[{origin:'KSEA',destination:'PANC',alternate_icao:'PAFA',fuel_release:{trip_fuel_lb:1000,taxi_fuel_lb:50,alternate_fuel_lb:300,reserve_fuel_lb:500,block_fuel_lb:1850},weight_balance:{basic_operating_weight_lb:24000,payload_lb:400,fuel_lb:5000,ramp_weight_lb:29400}}],airport_briefings:[{icao:'KSEA',status:'RESEARCHED'}]};assert.deepEqual(auditMission(m),[])
});
