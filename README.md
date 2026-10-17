# AeroMission Ops 2.0 — Ground-Up Rebuild

A new Node/Express + browser-native operations simulator designed for iPad and desktop. **This is a replacement application, not an incremental PATCH47 patch.**

## Start

1. Install Node 20+ and run `npm install`.
2. Run `npm start` and open `http://localhost:3000`.
3. Optional: configure `OPENAI_API_KEY` in the Render environment (not in the browser). Optionally set `OPENAI_MODEL` to a Responses API model that supports web search and structured JSON; default `gpt-4.1`.
4. Deploy via the included `render.yaml` or an existing Render web service (build `npm install`, start `npm start`).

## Modules

- Overview: mission/assignment/fleet summaries.
- Mission Builder: deterministic single and multi-leg mission creation, local persistence, no AI dependency.
- Job Board: six local simulation assignments and conversion into missions.
- Dispatch: itinerary, aircraft, airport briefings, METAR lookup, manifests, cargo, maintenance and document records, print-to-PDF.
- Airport research: first-stage AI web research followed by strict structured AI interpretation. Shows explicit partial/failure states. Does not invent FBOs or current fuel prices.
- Fleet/MX: editable local aircraft roster and maintenance notes.
- Live Flight: manual simulation status transitions.
- Logbook: completed simulated missions.
- Settings: JSON import/export, health and configuration.

## Data and safety

Data is stored in the browser's `localStorage`, **not** on Render or shared between devices. Back up before clearing browser data. There is no authentication, central synchronization, actual telemetry, validated aircraft performance, dispatch release authority or certified navigation data. All flights, job opportunities, timing estimates and flight status are simulations. Public aviation data and supplier pricing require independent verification. Browser Print → Save as PDF is used for dispatch documents.

## Testing

`npm test` runs core route, mission, job and briefing merge tests. The rebuild has not been live-tested with an OpenAI account or Render deployment. API availability and AI model capabilities depend on your configuration.

## Migration

This is a clean new data model; **PATCH47 browser storage is not automatically migrated**. Export or retain old app data separately before deploying over an existing service. Deploying this over the old app replaces its interface and server routes. Prefer a new Render service for a reversible trial.
