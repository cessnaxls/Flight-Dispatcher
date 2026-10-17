import json, threading, http.server, socketserver, os
from playwright.sync_api import sync_playwright
base='/mnt/data/AeroMission-Ops-AI-Rebuild/public';os.chdir(base)
class Server(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path=='/api/health':
   d=json.dumps({'ok':True,'version':'3.0.0','aiConfigured':True,'model':'gpt-4.1','vatsim':True}).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(d)));self.end_headers();self.wfile.write(d);return
  if self.path.startswith('/api/vatsim/pilot'):
   d=json.dumps({'pilot':None,'checked_at':'2026-10-16T21:00:00Z'}).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(d);return
  return super().do_GET()
server=socketserver.TCPServer(('127.0.0.1',8766),Server);threading.Thread(target=server.serve_forever,daemon=True).start()
brief={'icao':'ENGM','name':'Oslo Gardermoen Airport','municipality':'Oslo','country':'NO','status':'RESEARCHED','elevation_ft':681,'coordinates':'60.2, 11.1','runways':['01L/19R 3600m','01R/19L 2950m'],'frequencies':['TWR 120.1'],'customs':'Present','handling':'Business aviation','operational_notes':'Snow and low-visibility operations','fbos':[{'name':'Business aviation operator','services':'Handling','contact':'Telephone','hours':'On request','source_url':'https://example.com'}],'handlers':[],'fuels':[{'provider':'Airport fuel company','grade':'JET A-1','availability':'CONFIRMED','price_amount':9.2,'price_currency':'USD','price_unit':'GAL','price_type':'SIMULATION_ESTIMATE','price_basis':'illustrative','source_url':'https://example.com'}],'weather':{'metar':'ENGM 161950Z 15010KT 9999 FEW030 11/07 Q1015','taf':'TAF ENGM 1617/1718','status':'RETRIEVED'},'sources':['https://example.com'],'audit':{'stage':'COMPLETE','missing':[]}}
mission={'id':'demo1','code':'AM-DEMOTEST','title':'Nordic medical logistics charter','type':'Medical','mission_profile':'An emergency oncology research delivery supporting a specialty hospital and surgical team.','status':'PLANNING','aircraft':{'registration':'LN-TEST','registration_status':'VERIFIED','model':'Citation XLS','icao_type':'C56X','year_built':2005,'registration_sources':['https://example.com']},'risk':{'age_years':21,'risk_band':'ELEVATED','simulation_risk_score':51},'mx_status':'OK','crew':[{'name':'Alex','role':'Captain'}],'passengers':[{'name':'Dr Morgan','role':'Physician'}],'cargo':[{'description':'Cold chain package','weight_lb':80}],'legs':[{'origin':'ENGM','destination':'EGAA','alternate_icao':'EDDP','distance_nm':600,'fuel_release':{'trip_fuel_lb':2500,'reserve_fuel_lb':700},'weight_balance':{'takeoff_weight_lb':17000},'told':{'takeoff_distance_ft':3700}}],'airport_briefings':[brief,{**brief,'icao':'EGAA','name':'Belfast International'},{**brief,'icao':'EDDP','name':'Leipzig/Halle'}],'mx':{'scenario_status':'AI GENERATED — REVIEW REQUIRED','defects':[{'equipment':'Cabin light','category':'MEL','mel_reference':'OPERATOR MEL REQUIRED','msfs_steps':['Disable cabin light via cockpit switch']} ]},'research':{'status':'COMPLETE','summary':'3/3 airports validated', 'errors':[]}}
state={'view':'dispatch','tab':'airports','selected':'demo1','missions':[mission],'jobs':[],'fleet':[],'logbook':[],'settings':{'theme':'dark','units':'imperial','vatsimCid':''}}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':900},device_scale_factor=1)
 page.add_init_script('localStorage.setItem("aeromission-ai-v3",JSON.stringify('+json.dumps(state)+'));')
 errors=[];page.on('pageerror',lambda exc:errors.append(str(exc)))
 page.goto('http://127.0.0.1:8766/',wait_until='domcontentloaded');page.wait_for_timeout(1800)
 page.screenshot(path='/mnt/data/AeroMission-Ops-AI-Rebuild/browser-preview.png',full_page=True)
 assert page.locator('text=Oslo Gardermoen Airport').count()>0
 assert page.locator('text=SIMULATION_ESTIMATE').count()>0
 page.locator('button[data-tab="mx"]').click();assert page.locator('text=Disable cabin light').count()>0
 page.locator('button[data-nav="builder"]').click();assert page.locator('#mission-form').count()==1
 page.locator('button[data-nav="settings"]').click();assert page.locator('input[name="vatsimCid"]').count()==1
 assert not errors,errors
 print('Browser UI smoke passed: airport, fuel estimate, MX steps, builder and VATSIM settings; no JS page errors')
 browser.close()
server.shutdown()
