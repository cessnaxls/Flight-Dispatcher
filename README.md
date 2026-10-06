# AeroMission Ops — iPad / Git / Render

This is the web/PWA edition of AeroMission Ops. It is designed for iPad Safari and deployment from GitHub to Render.

## Deploy
1. Create a GitHub repo and upload the contents of this folder.
2. In Render, create a Blueprint from the repo (`render.yaml` is included), or create a Node Web Service.
3. Add `OPENAI_API_KEY` in Render > Environment. Do **not** commit the key.
4. Deploy.
5. Open the Render URL in Safari on iPad. Use Share > Add to Home Screen for an app-like PWA.

## Data
Mission/fleet/logbook/settings data is stored in the iPad browser's localStorage. This avoids requiring a database for a personal single-iPad deployment. Clearing Safari website data will clear it.

## MSFS
A cloud-hosted iPad web app cannot directly use Windows SimConnect. Live Flight is intentionally prepared for a later Windows companion bridge. Planning, AI mission generation, job board, dispatch, paperwork UI, fleet and PDFs work without SimConnect.

## Paperwork
The UI accepts PDF files only. This first web build submits only PDF metadata to the silent AI audit endpoint; it does not upload PDF bytes. The verdict is intentionally hidden from the UI.

## Operational disclaimer
Training/simulation only. AI-generated MEL, legal, performance, fuel-price estimates and maintenance records are not real-world operational authority.


## PATCH 24 — mission-first staged generation
- Restores mission-first creative architecture: concept -> aircraft type -> verified public registration -> detailed operational expansion -> weather/FBO enrichment.
- AI DECIDES no longer resolves a random aircraft before inventing the assignment.
- Job Board selections themselves serve as the creative concept before aircraft resolution.
- Removed the diversity-seed workaround from Mission Builder flow. Recent missions remain exclusion context only for the concept pass.
- Aircraft identity status is VERIFIED PUBLIC MATCH or UNRESOLVED; no PLAUSIBLE status.
- Removed whole-mission rejection based only on immersion-breaking keyword scanning; structural validation remains.


PATCH 27: Cross-platform PDF printing. Trip Sheet and Dispatch print from the in-app rendered pages using the browser print dialog/AirPrint rather than navigating to blob: PDF URLs. Added SAVE / SHARE for native iPad share sheet or desktop PDF download.


## PATCH 29
Mission MX now uses a per-mission maintenance-event roll. BAD requires multiple specific open MEL/CDL/INOP discrepancies; OK and GOOD can still be clean but have meaningful probabilities of a specific deferred item; RANDOM spans poor through pristine states. When the roll requires an item, mission validation enforces that it was actually populated, including FOUND DURING PREFLIGHT when selected. Discrepancies remain generated mission state and are not claims about the real registration.


## PATCH 34 — mission generation reliability
- Treats mission concept/job and resolved aircraft identity as authoritative server-side data. The expansion pass can no longer erase title, operation, aircraft type, or verified registration.
- Restores Job Board itinerary legs if an expansion response omits them.
- A primary mission timeout with no response no longer tries to repair `{}`; it performs one compact fallback generation using the original request.
- Mission primary timeout is capped at 60 s, compact fallback at 22 s, and validation correction at 12 s.
- Existing section-tolerant preservation remains in place.
- MX directive now also caps excess MEL/CDL/INOP items at the requested maximum.
