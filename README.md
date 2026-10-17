# AeroMission Ops 3.0 — AI-First Flight Simulation Operations

**Ground-up replacement of AeroMission Ops 2.0.** Built for iPad, desktop browsers, GitHub and free Render web services. This is flight-simulation software, **not aviation dispatch software**.

## What this build does

**Mission Builder** — A true AI-driven mission generator. Leave filters empty and AI chooses a detailed scenario, client, tasking, aircraft type, registration candidate, route, 1–6+ legs, alternates, crew, manifest, cargo, operational constraints and documents. Enter an ICAO route to constrain the AI; the application validates/preserves that route. Single missions use the same background AI flow as Job Board missions, without short browser-side aborts. A missing legs array can be rebuilt **only from ICAO airports the AI/user actually provided**, never canned routes. If AI still supplies no route, the error and Retry remain visible instead of presenting an unusable mission.

**AI Job Board** — Distinct AI-created assignments based on aviation/geographic constraints. Every usable job is retained even if fewer than six are returned. Assignments become full, AI-enriched missions after selection, not simplistic local templated scenarios.

**Aircraft / fleet** — Two-stage AI research matches real aircraft registrations and public manufacturer/type data, reporting a public-source match, unverified or conflict. A registration mismatch is not silently accepted. Manufacture year is recorded only when supported; age, GOOD / OK / BAD and age-influence options drive a **simulated reliability index** and maintenance scenario pressure. Fleet selections populate Mission Builder. Updating a fleet MX level also updates matching saved missions and queues revised scenario research.

**MEL / CDL / INOP** — AI researches type-specific discrepancies, deferral conditions and source documents, and generates Microsoft Flight Simulator cockpit/failure-menu actions to recreate each scenario where supported. Any reference or dispatch limitation that cannot be verified is labeled uncertain. A CDL is reserved for missing external components, not ordinary failed cabin accessories. **These are hypothetical simulation defects, NOT operator-approved MEL/CDL authorizations.** GOOD-condition aircraft may legitimately have zero defects.

**Dispatch & airport research** — Every origin, destination, intermediate and selected alternate airport receives an airport briefing record. The app retrieves public reference runway/frequency/field data separately, live NOAA METAR when available, then performs open-ended AI web research followed by strict JSON interpretation. Briefs include runways, frequencies, elevation, coordinates, PPR, customs, parking, handlers/FBOs, fuel suppliers and grades, published prices with date/source *where public*, and separately labeled simulation fuel-price estimates when defensible. No missing actual price is disguised as a current quote. Incomplete results retain previous known fields and show an audit/error + Retry.

**Legs / manifests / paperwork** — AI interprets aircraft-specific simulation fuel ledger, fuel release, TOLD, approximate runway distances, weights and W&B. When certified type data is not defensibly available, fields such as V speeds and CG remain null rather than posing as approved. Direct **Download dispatch PDF** produces a multi-page professional simulation briefing containing mission profile, full leg/airport packets, fuel, MX and MSFS instructions, required document register, manifests, research citations and a release review checklist.

**VATSIM / logbook** — Set a **5–9 digit VATSIM CID** in Settings. The backend reads the official public feed `https://data.vatsim.net/v3/vatsim-data.json`, returning only the matching pilot's relevant data (excluding the name field). The UI refreshes approximately every 90 seconds while open and records observed flight sessions locally, including filed dep/dest, callsign, first/last seen, max altitude and max groundspeed. **It does not reconstruct previous unobserved flights or claim that an aircraft actually landed**: the public Data API is a live feed, not a full historical logbook. A closed tab, sleeping browser/iPad, network loss or a sleeping free Render service means gaps in session observations. Import/export observed sessions via Settings/Logbook. The separate VATSIM Core API requires credentials for nonpublic history access and is not used.

**Traceability & stability** — AI jobs launch via Responses API `background:true, store:true`. The UI polls research, starts structured interpretation, then applies validated results to saved missions. Up to two active AI jobs at once; all task identifiers/phases are saved in localStorage so browser refresh can resume while the upstream Responses jobs still exist. No 30–40 second frontend `AbortController` kills generation. The queue displays stage and errors; each failed task can be retried independently. OpenAI background responses may expire if left unpolled (typically about 10 minutes); retry if necessary.

## Installation (local)

1. Install Node.js **20+**.
2. In this directory run `npm install`.
3. Set `OPENAI_API_KEY` as a **server environment variable** (required for AI generation).
4. Optionally set `OPENAI_MODEL=gpt-4.1` (default, must support Responses background/web search/strict structured output).
5. Optionally set `APP_ACCESS_PIN=your-secret-pin` to protect paid AI API calls on a personally operated server.
6. Run `npm start` and visit `http://localhost:3000`.
7. In **Settings**, enter VATSIM CID, optional access PIN, home base and default MX condition.

### Render deployment

The included `render.yaml` specifies a standard **free** Render Node web service. Build command `npm install`, start command `npm start`, health endpoint `/api/health`. Push these files to a *new* GitHub repository or branch and create a separate Render service while testing (do not overwrite the old production app immediately). Set `OPENAI_API_KEY` in the Render Environment panel; never put the key in `public/` or a GitHub commit. If using `APP_ACCESS_PIN`, put the same value into **Settings → App access PIN** in each browser. `OPENAI_MODEL` can be changed in Render and will be reflected in Settings health.

### Storage and migration

Missions, fleet profiles, AI task IDs and VATSIM observations are saved in **browser localStorage** on the user's device. This avoids server-side data loss on free Render restarts but does not sync across browsers/devices or survive browser-data clearing. Use **Settings → Download backup** and Import backup for portability. If ground-up 2.0 is installed on the same domain, this app will read and normalize the v2 browser database on first load, including old departure/arrival timestamps, FBO sources, documents, manifests and fleet statuses. Old undated price fields are migrated as UNVERIFIED, never as confirmed posted prices. It **does not automatically migrate PATCH47** and does not erase PATCH47 data. Deploy separately first and export important old records.

### Routes

- `GET /api/health` — backend/model/PIN readiness; public.
- `POST /api/ai/start` — launches the research phase of `mission`, `jobs`, `aircraft`, `airport`, `mx`, `leg` jobs.
- `POST /api/ai/poll` — polls the job; if research completes, starts strict-schema interpretation; if interpretation completes, returns validated mission/job/airport/aircraft/MX/leg data.
- `GET /api/airport/:icao/reference` — OurAirports aerodrome/reference data; no fabricated FBOs.
- `GET /api/weather/:icao` — live NOAA Aviation Weather METAR (best effort).
- `GET /api/vatsim/live?cid=1234567` — public live VATSIM pilot snapshot for CID.
- `POST /api/dispatch/pdf` — multi-page PDF dispatch simulation briefing from the saved mission.
- `GET /api/debug` — server AI stages, failures and timings (limited in-memory log).

Except health, routes require `X-App-Pin` when `APP_ACCESS_PIN` is configured. API calls do not accept arbitrary freeform system prompts; all task categories have fixed instructions and constrained payload lengths. A basic in-memory limit of 50 AI launches per hour per address discourages abuse. **For an internet-facing multi-user product, add real authentication, account-specific limits and a database; a shared PIN is basic personal-service protection only.**

### Test

Run `npm test` (after installing dependencies). The source contains **15 automated tests** for AI background research → structured interpretation → mission normalization, unavailable airport pricing, registration conflict handling, airport-reference merge behavior, age/MX pressure, mission/Job Board validation and VATSIM live CID extraction.

### Data integrity and known limits

- AI may fail to find a **public** FBO, verified aircraft manufacture year, applicable operator MEL, airport restrictions, exact fuel quotation or credible numeric performance input. Such data is **not silently fabricated as confirmed**. The status/audit and retry action remain visible.
- Web AI searches and interpreting one mission with multiple airports and legs consume **multiple paid OpenAI requests**; external site availability, model permissions and OpenAI rate limits still affect outcomes.
- Direct PDF export requires server-side `pdfkit` dependency installed by `npm install`; if airport AI research is incomplete, the browser will ask before exporting a PARTIAL package.
- VATSIM logs are snapshots **only while this app is active**, not a full historical download or legal pilot log.
- No certified AFM/TOLD, MEL approval, dispatch signature, ATC filing, IFR route certification, aircraft controller integration or real-world operational clearance is provided.
- This project has browser-local saves and is designed for one user's simulations, not shared airline dispatch workflows.

## Source layout

| File | Purpose |
| --- | --- |
| `server.js` | Express API, key/PIN guard, rate-limit and diagnostics |
| `ai.js` | Fixed AI prompts, web-research/interpretation pipeline, strict schemas, type validation |
| `models.js` | Mission and job normalization, age/MX scenario rating, airport merges and journal helpers |
| `airport-data.js` | Public OurAirports airport/runway/frequency reference cache |
| `vatsim.js` | Validated CID lookup and redacted live pilot snapshot |
| `pdf.js` | Multi-page dispatch package renderer |
| `public/app.js`, `style.css`, `pdf-client.js` | Responsive SPA, persistent research queue, live monitoring, PDF export |
| `test/*.test.js` | Unit/orchestration tests |

## Operational test checklist

1. Open Settings: verify **AI ENABLED**; configure CID and access PIN if used.
2. Generate a single `ENGM → EGAA` flight with GOOD or OK MX and type `BE58`; verify AI mission appears and departure/destination/alternate records are created.
3. Generate an unfiltered AI mission; verify route/story vary and do not default to fixed routes.
4. Generate six job board opportunities; select one; verify a separate full AI mission is created.
5. Research `ENGM`, `EDDP`, `EGAA`: check public aerodrome fields, named sources, individual handling providers and fuel supplier pricing status. Do **not** require a fabricated published price where unavailable.
6. Research a known type/tail; confirm a wrong-type tail is flagged as a conflict.
7. Change MX GOOD → BAD with age influence; re-run MX and verify sim severity and MSFS actions change plausibly.
8. Refresh VATSIM with your configured CID; if offline, verify status OFFLINE without a fabricated logbook flight.
9. While actually connected, verify flight plan/altitude samples and observed logbook session; close the app and note collection gaps.
10. Download the PDF; verify cover, itinerary, aircraft identity, MEL/CDL/MSFS procedures, leg fuel/performance/W&B, airport briefs/FBO/fuel pricing, document list and sources.
11. Kill/refresh the browser during an AI research job; reopen and confirm task resumes or a clear expiry/error appears.
12. Export/import a backup in a test browser; check missions, fleet, logs and CID settings survived.

**Status:** Core static/unit test coverage is included. Live OpenAI/Render/NOAA/VATSIM provider end-to-end calls must be tested with actual accounts and deployed network access. See in-app task/audit states for failures.
