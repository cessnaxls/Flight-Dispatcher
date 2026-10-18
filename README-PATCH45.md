# PATCH 45 — Independent OpenAI ground-support research

Retains mission generation. Airport-ground-support research is split into standalone web-enabled background OpenAI requests per ICAO to find named FBOs, ramp/cargo handlers, fuel suppliers, fuel grades, contact details, and any sourced published fuel price or clearly marked planning estimate.

Fixes provider records being discarded when the independent airport-identity request did not return the required proof fields. Existing provider results survive later, partial airport-identity responses.

A provider row requires a supporting URL. Absence of published prices is displayed as quote required; AI estimates must remain labeled as estimates, not quotations.

Run on Render free plan with OPENAI_API_KEY, deploy from GitHub, press RETRY WEATHER / GROUND SUPPORT on the relevant mission. Wait for both airport:* and providers:* research states to complete. API usage is separately billed. Research may be limited by provider outages, quota, free-instance sleep, or unavailable sources; no application can guarantee zero timeouts.

Checks: node --check for server.js, ai-research.js, public/app.js; mocked source-backed provider merge test. Live OpenAI / Render integration has not been tested.
