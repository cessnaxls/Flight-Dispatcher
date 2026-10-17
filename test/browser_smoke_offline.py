import json
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
original=(root/'test/browser_smoke.py').read_text();context={};exec(original[original.index('brief='):original.index('with sync_playwright()')],context)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-web-security'])
 page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
 errors=[];page.on('pageerror',lambda exc:errors.append(str(exc)))
 page.goto('about:blank');page.set_content('<html><head></head><body><div id="app"></div><div id="toast-region"></div></body></html>')
 state=json.dumps(context['state'])
 page.evaluate('''(state)=>{const memory=new Map([['aeromission-ai-v3',state]]);Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)}});window.fetch=async (path)=>{let data={ok:true,version:'3.0.0',aiConfigured:true,model:'gpt-4.1',vatsim:true};if(String(path).startsWith('/api/vatsim/'))data={pilot:null,checked_at:new Date().toISOString()};return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>data}}}''',state)
 # Direct injection avoids the sandbox's admin policy blocking navigation to any local or remote address.
 css=(root/'public/style.css').read_text();css=css[css.find(':root{'):]
 page.add_style_tag(content=css)
 page.add_script_tag(content=(root/'public/app.js').read_text())
 page.wait_for_timeout(650)
 print('Title:',page.locator('h1').first.inner_text() if page.locator('h1').count() else '(none)')
 page.screenshot(path=str(root/'browser-preview.png'),full_page=True)
 assert page.locator('text=Oslo Gardermoen Airport').count()>0
 assert page.locator('text=SIMULATION_ESTIMATE').count()>0
 page.locator('button[data-tab="mx"]').click();assert page.locator('text=Disable cabin light').count()>0
 page.locator('button[data-nav="builder"]').click();assert page.locator('#mission-form').count()==1
 page.locator('button[data-nav="settings"]').click();assert page.locator('input[name="vatsimCid"]').count()==1
 assert not errors,errors
 print('Offline Chromium UI smoke passed: airport, fuel estimate, MX steps, builder and VATSIM settings; no JS page errors')
 browser.close()
