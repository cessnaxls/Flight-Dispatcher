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
