import test from 'node:test';import assert from 'node:assert/strict';import {createMission,createJobs,routeFromText,validateMission,mergeBriefing} from '../engine.js';
test('creates single mission with valid leg independent of AI',()=>{const m=createMission({route:['ENGM','EGAA']});assert.equal(m.legs.length,1);assert.ok(validateMission(m));assert.equal(m.airport_briefings.length,2)});
test('creates multi-leg itinerary',()=>{const m=createMission({route:['ENGM','EGAA','EDDP']});assert.equal(m.legs.length,2);assert.equal(m.legs[1].origin,'EGAA')});
test('invalid route rejected clearly',()=>assert.throws(()=>createMission({route:['ENGM']}),/at least two/));
test('job board produces six complete jobs',()=>{const j=createJobs(6);assert.equal(j.length,6);assert.ok(j.every(x=>x.route.length===2))});
test('route extraction',()=>assert.deepEqual(routeFromText('Fly ENGM to EGAA via EDDP'),['ENGM','EGAA','EDDP']));
test('airport data merges into matching record',()=>{const m=createMission({route:['ENGM','EGAA']});mergeBriefing(m,{icao:'ENGM',fbos:[{name:'Example'}]});assert.equal(m.airport_briefings[0].fbos.length,1)});
