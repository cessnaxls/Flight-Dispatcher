import json
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
original=(root/'test/browser_smoke.py').read_text();fixtures={};exec(original[original.index('brief='):original.index('with sync_playwright()')],fixtures)
mission=fixtures['mission'];brief=fixtures['brief'];job={'id':'JOB-X1','title':'Alpine cargo','type':'Special charter','description':'Equipment transport','mission_profile':'Deliver equipment to a specialist crew','route':['ENGM','EGAA'],'aircraft_type':'C25C','mx_status':'BAD','status':'AVAILABLE'}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-web-security'])
 page=browser.new_page(viewport={'width':1200,'height':800})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('about:blank');page.set_content('<div id="app"></div><div id="toast-region"></div>')
 fixtures={"mission":mission,"brief":brief,"job":job}
 page.evaluate('''(f)=>{const memory=new Map();window._memory=memory;Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)}});let num=0;const tasks={};
 window.fetch=async (path,options={})=>{let data={ok:true,version:'3.0.0',aiConfigured:true,model:'gpt-4.1',vatsim:true},status=200;const endpoint=String(path);if(endpoint.startsWith('/api/tasks/')&&options.method==='POST'){const kind=endpoint.split('/').at(-1);const id='fake-task-'+(++num);tasks[id]={status:'COMPLETE',id,kind:kind==='mission'?'MISSION':kind==='jobs'?'JOBS':kind==='airport'?'AIRPORT':kind==='airports'?'AIRPORTS':'AIRCRAFT',stage:'COMPLETE',detail:'AI result mocked',history:[],result:kind==='mission'?{mission:{...f.mission,id:'new-mission-'+num,code:'AM-'+num}}:kind==='jobs'?{jobs:[f.job]}:kind==='airports'?{briefings:[f.brief],errors:[]}:kind==='airport'?{briefing:f.brief}:{aircraft:f.mission.aircraft,mx:f.mission.mx}};data={id,status:'RUNNING'};status=202}
 else if(endpoint.startsWith('/api/tasks/')){data=tasks[endpoint.split('/').at(-1)]||{error:'bad task'};if(!data.status)status=404;}
 else if(endpoint.startsWith('/api/vatsim/pilot')){data={checked_at:new Date().toISOString(),pilot:{cid:1234567,callsign:'N123AB',logon_time:'2026-10-16T20:00:00Z',altitude_ft:14000,groundspeed_kts:220,lat:37,lon:-81,flight_plan:{departure:'ENGM',arrival:'EGAA',aircraft:'C25C',route:'DCT'}}};}
 else if(endpoint.startsWith('/api/weather/')){data={metar:'MOCK METAR',status:'RETRIEVED',retrieved_at:new Date().toISOString()}};
 return {ok:status<400,status,headers:{get:()=> 'application/json'},json:async()=>data}}}''',fixtures)
 page.add_style_tag(content=(root/'public/style.css').read_text().split(':root{',1)[1].join([]) if False else ':root{'+(root/'public/style.css').read_text().split(':root{',1)[1])
 page.add_script_tag(content=(root/'public/app.js').read_text())
 page.wait_for_timeout(180)
 page.locator('button[data-nav="builder"]').click()
 page.locator('#mission-form input[name="starting_point"]').fill('ENGM')
 page.locator('#mission-form select[name="mx_status"]').select_option('BAD')
 page.locator('#mission-form button[type="submit"]').click()
 page.wait_for_function("document.querySelector('h1')?.textContent.includes('Flight dispatch')",timeout=10000)
 assert page.locator('text=Nordic medical logistics charter').count()>0
 state=json.loads(page.evaluate("window._memory.get('aeromission-ai-v3')"));assert len(state['missions'])==1, state['missions'];assert state['taskId']==''
 page.locator('button[data-nav="jobs"]').click()
 page.locator('#jobs-form button[type="submit"]').click()
 page.wait_for_timeout(650)
 assert page.locator('text=Alpine cargo').count()>0
 page.locator('button[data-accept="JOB-X1"]').click()
 page.wait_for_timeout(700)
 state=json.loads(page.evaluate("window._memory.get('aeromission-ai-v3')"));assert len(state['missions'])==2
 assert state['jobs'][0]['status']=='ASSIGNED',state['jobs']
 page.locator('button[data-nav="settings"]').click()
 page.locator('input[name="vatsimCid"]').fill('1234567')
 page.locator('#settings-form button[type="submit"]').click()
 page.wait_for_timeout(450)
 state=json.loads(page.evaluate("window._memory.get('aeromission-ai-v3')"));assert len(state['logbook'])==1
 assert state['logbook'][0]['status']=='TRACKING'
 assert not errors,errors
 print('Task/UI E2E mock PASS: builder->AI mission->dispatch, jobs->accepted mission, CID->VATSIM logbook')
 browser.close()
