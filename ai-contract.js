// PATCH 42 — Exact AI-to-dispatch field contract.
export const CONTRACTS={
 airport:{icao:'ICAO identifier',field_summary:'airport name, location, operating hours',field_elevation:'field elevation with units',coordinates:'latitude and longitude',runways:'array of runway objects with designation, dimensions, surface, lighting, declared distances and source',frequencies:'array of service/frequency objects',limitations:'published operating limitations and restrictions',customs:'customs/immigration availability and prior-notice requirements',handling:'handling requirements and parking/PPR procedures',fbos:'array of verified on-airport FBOs, ground handlers, cargo handlers and fuel suppliers: {name,provider_type,presence,services,contact,fuels:[{type,availability,price,price_unit,price_updated,price_status}],source}',sources:'array of source URLs',research_status:'COMPLETE or PARTIAL, with outstanding issues'},
 leg:{fuel_release:{release_fuel:'quantity with units',taxi_fuel:'quantity with units',trip_fuel:'quantity with units',contingency_fuel:'quantity with units',alternate_fuel:'quantity with units',reserve_fuel:'quantity with units',extra_fuel:'quantity with units',planned_landing_fuel:'quantity with units',fuel_basis:'aircraft-specific calculation, assumptions and estimate status'},told:{runway:'runway identifier',runway_condition:'surface condition',wind:'wind',oat:'temperature',qnh_altimeter:'pressure',takeoff_weight:'weight with units',landing_weight:'weight with units',v1:'speed or reason not derivable',vr:'speed or reason not derivable',v2:'speed or reason not derivable',takeoff_distance:'distance or reason not derivable',landing_distance:'distance or reason not derivable',status:'SIMULATION ESTIMATE or VERIFIED REFERENCE'},weight_balance:{zfw:'weight with units',tow:'weight with units',ldw:'weight with units',cg:'CG if moment arms available, otherwise explain missing arms',cg_limits:'published envelope or source limitation',status:'SIMULATION ESTIMATE or VERIFIED REFERENCE'},planning_status:'research status and assumptions',sources:'array of source URLs'}
};
export function missingPaths(data,contract,prefix=''){
 const missing=[];
 for(const [k,v] of Object.entries(contract)){
  const path=prefix?`${prefix}.${k}`:k,got=data?.[k];
  if(got===undefined||got===null||got===''||(Array.isArray(got)&&!got.length))missing.push(path);
  else if(v&&typeof v==='object'&&!Array.isArray(v))missing.push(...missingPaths(got,v,path));
 }
 return missing;
}
export function validateSection(section,data,key){
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('AI research did not return an object');
 if(section==='airport'&&data.icao&&String(data.icao).toUpperCase()!==key)throw Error('Airport research ICAO mismatch');
 for(const k of ['fbos','sources','runways','frequencies'])if(data[k]!==undefined&&!Array.isArray(data[k]))throw Error(`Invalid ${k}: expected array`);
 for(const k of ['fuel_release','told','weight_balance'])if(section==='leg'&&data[k]!==undefined&&(typeof data[k]!=='object'||Array.isArray(data[k])))throw Error(`Invalid ${k}: expected object`);
 return missingPaths(data,CONTRACTS[section]);
}
