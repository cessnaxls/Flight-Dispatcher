# AeroMission Ops 3 — AI-First Rebuild

A brand-new, responsive browser/iPad simulator operations application. **AI creates missions and charter assignments**, researches real registration candidates, simulates aircraft age/maintenance discrepancies, builds leg plans, researches departure/destination/alternate airports and providers, and produces a multipage simulation dispatch PDF. VATSIM CID connects the live public VATSIM feed to a browser-observed flight logbook.

> **SIMULATION ONLY.** Not an aviation dispatch or certified flight-planning product. No AI-produced MEL/CDL release, fuel price, performance estimate, NOTAM, flight plan or registry match should be used for real-world flight.

## Installation / deploy on free Render

1. Extract this ZIP and push the **contents of this folder** to a GitHub repository (keep `package.json`, `server.js`, `public/` at the repository root).
2. Create a **new** Render Web Service from the repo, or use the supplied `render.yaml`. Use **Node 22**, `npm install`, `npm start`, and health path `/api/health`.
3. Either add `OPENAI_API_KEY` as a **secret Render environment variable**, or open **Settings → OpenAI API key** after deployment and paste your key into this device. Do not commit or expose it in the browser. Set `OPENAI_MODEL=gpt-4.1` initially; choosing another model requires support for the current Responses API and web-search tool.
4. Strongly recommended for a public Render URL: add `APP_PASSCODE` as a private Render environment variable, then enter that same passcode in **Settings** on each browser. Otherwise strangers reaching your public URL may consume your paid OpenAI API credits.
5. Wait for Render to deploy; open its URL on iPad/desktop. Confirm **AI configured** on Dashboard and Settings. Add your numeric VATSIM CID in Settings to enable network observation.
6. **Deploy separately from PATCH47** until satisfied. Old PATCH47 localStorage is **not automatically migrated**. The replacement can import supported JSON backups from prior rebuilt versions best-effort; always preserve an export first.

### Run locally

Install Node 20+; run `npm install`, export `OPENAI_API_KEY`, then `npm start`; open `http://localhost:3000`.

## Workflow

**Mission Builder**: enter any constraints you want (scenario, home region, airport route, aircraft ICAO model, registration, desired legs, MX GOOD/OK/BAD, age weighting), or leave fields blank for original AI concepts. Generation submits a server task; the UI displays progress and can show the initial mission as aircraft, route, maintenance, individual leg calculations, weather and airports are researched. If the AI supplies a route without fully structured legs, the app derives legs from that AI-supplied route; it **does not substitute a canned itinerary**. Errors are shown instead of producing a pretend completed mission.

**Job Board**: AI researches/generates diverse scenario assignments; five valid jobs out of six are accepted. Clicking Accept launches the **full mission pipeline** for that assignment, including its customized story and logistics.

**Fleet / MX**: AI checks public aircraft registration/type/year records and labels VERIFIED, CONFLICT or UNVERIFIED. A registration/type conflict is not silently replaced. Aircraft year and the selected GOOD/OK/BAD maintenance condition affect the **simulation reliability score**. AI generates plausible type-sensitive INOP equipment, simulated MEL-like deferrals, CDL items *only for missing external components*, restrictions, repair suggestions and explicit MSFS actions. GOOD may reasonably have zero defects; BAD forces at least one. Operators' actual MEL authorizations are not provided.

**Dispatch**: Mission profile, legs and schedules, fuel and weight estimates, TOLD where defensible, manifests, aircraft evidence, simulated MX and MSFS actions, departure/destination/alternate airport briefs, customs/PPR/limitations, weather, named FBOs/handlers, named fuel suppliers and offered grades. Airport AI follows **web research dossier → separate structured AI interpretation**. A fuel price is marked PUBLISHED only with a dated source. Otherwise it is explicitly SIMULATION_ESTIMATE / QUOTE_REQUIRED / UNAVAILABLE; never silently a live quote. Individual airport failures produce a warning and retry action instead of pretending that no providers exist. Download the professional multipage simulation PDF when ready; partially researched PDFs must be treated as incomplete.

**Live Flight / Logbook**: Enter **VATSIM CID** in Settings. While this page stays open and visible, the app checks `https://data.vatsim.net/v3/vatsim-data.json` approximately once per minute. Matches are tracked as observed sessions: callsign, filed flight plan, origin/destination/route, sampled altitude/ground speed and observation times. Going offline becomes **CONNECTION_ENDED_UNCONFIRMED**—not an automatic landing. You may manually confirm completion. VATSIM's public live feed **does not provide full historical flights**; browser sleep, closing tabs, network disruptions and Render sleeping can produce missing data. This is not an official VATSIM logbook or historical importer.

**Settings**: UI theme/units, home airport, preferred PIC, default MX condition and age influence, CID and monitoring toggle, APP_PASSCODE, backups and server research/debug log.

## Privacy, costs and persistence

The OpenAI API key remains server-side. Missions, tasks, logbook, fleet and preferences are stored in browser **localStorage**; browser resets delete them, and records do not automatically sync across devices. Export a JSON backup regularly. The server keeps running task states and diagnostics **in memory**, so a Render restart while a task runs loses that task; saved browser missions remain. Each new airport, aircraft or leg can trigger paid OpenAI usage. Public VATSIM snapshots are served through the backend; the app does not save the pilot name from the live feed.

## API and code

- `GET /api/health` — server/model readiness.
- `POST /api/tasks/mission`, `/jobs`, `/aircraft`, `/airport`, `/airports` — background task launches; `GET /api/tasks/:id` reports status, stage, partial data, result or error.
- `GET /api/vatsim/pilot?cid=1234567` — matching public live pilot snapshot.
- `GET /api/weather/:icao` — public NOAA METAR/TAF where available.
- `POST /api/dispatch/pdf` — PDF generation from saved mission.
- `GET /api/debug` — recent task stage/error log.

`server.js` implements the service and task management; `ai.js` implements stage-specific AI; `domain.js` normalizes application data; `pipeline.js` runs integrated enrichment; `airport-data.js` provides public aerodrome reference fields; `vatsim.js` filters/observes VATSIM data; `pdf.js` renders PDF; `public/` contains the responsive client.

## Tests

Run `npm run check` and `npm test`. The 18 Node automated tests exercise mission and route normalization, missing itinerary behavior, age/MX scoring, MEL/MSFS fields, provenance-aware airport prices, partial data, job counts, registration evidence, full-airport enrichment, VATSIM and JSON interpretation robustness.

Headless browser tests can be run with a local Playwright Python/Chromium installation: `python test/browser_smoke_offline.py`, `python test/browser_tasks_offline.py`. They mock APIs, exercise page navigation and user flows; they do **not** certify real OpenAI or Render connectivity.

## Honest release limitations

- AI web-search accuracy, provider availability, runway/airport updates, registry status, MEL applicability and prices are not guaranteed. Actual fuel vendors commonly require a direct quote; missing actual prices stay unresolved.
- Real OpenAI, VATSIM, NOAA and Render integration have not been end-to-end tested in this artifact's build environment. Run the in-app research task and inspect audit/error details in the live deployment.
- The app does not record a flight when closed and does not fetch VATSIM historical flight logs from an authenticated account.
- Certified performance figures and approved MEL/CDL releases cannot be generated safely from generalized AI research; numeric planning data is marked as simulation data and may remain unavailable.

## Browser-session API key (new in v3.1)

Go to **Settings → OpenAI API key — this device**. Paste a key, choose **Save key on this device**, and select **Test OpenAI connection**. All AI task requests (missions, jobs, airport research and fleet) use this key when present; otherwise they use the Render `OPENAI_API_KEY`. A server restart does not destroy a key that remains in the active tab session, but clearing local browser site data or selecting Remove saved key does. Each device needs its own entry. Keys are stored in localStorage on this browser, but are not included in exported app backups, mission objects, or application logs. Browser localStorage is readable by scripts on the same site; a Render environment secret is safer.

**Security:** The key necessarily exists in the browser and travels via HTTPS to your Render backend. Browser extensions, compromised origin scripts, shared devices or compromised hosting can expose it; for the strongest security use a server-side Render secret and an `APP_PASSCODE`, and do not share your deployed app publicly. The connection test contacts OpenAI's model-listing endpoint and uses your account credentials; it does not guarantee web-search model capabilities.


## 3.3 task recovery

Render free-service restarts can remove in-memory AI tasks. The browser now detects an expired task on the first 404, clears the blocking task ID, and displays a Retry previous AI request button for tasks started after this update. Tasks started before upgrading can be dismissed, and a new mission created. Temporary connection losses expose Resume polling or Clear stuck task. This does not make an in-progress server AI job durable across a Render restart; restart-safe persistence would require a separate durable task store.


## 3.4 changes / PDF quality gates
Mission concept generation uses a bounded natural-language first pass to mitigate token-limit truncation; structured output permits a larger token budget and separate flight planning. Airport reference facts are published to the in-progress mission before AI research. The PDF has an explicit integrity review for aircraft conflicts, route continuity, dates, fuel/weight arithmetic and incomplete airport research; airport elevation no longer prints undefined. Footer placement no longer relies on a text cursor below the PDFKit page bottom margin (which caused 20 footer-only extra pages). A draft download requires confirmation while research is still running. Unverified aviation numbers remain simulation-only.
