# Data export & what we track

## Client data → Excel (easy)

- **Export Excel (visible)** – Exports the clients currently shown in the table (after search/filter) to an Excel file.
- **Export all (Excel)** – Fetches every client from the API and exports them to one Excel file.

The Excel file includes all client fields:

- Identity: ID, FIRST, LAST, FULL_NAME, ADDRESS, APT, CITY, STATE, ZIP, COUNTY, PHONE
- Flags: MEDICAID, PAUSED, COMPLEX, BILL, DELIVERY
- Unite Us link: **CLIENT_ID**, **CASE_ID** (use these to connect to Unite Us)
- Billing: **BILLINGS_JSON** (full billing history)
- Geo: LAT, LNG, GEOCODED_AT
- Schedule: MON–SUN, SCHEDULE_JSON
- Other: DISLIKES, SIGN_TOKEN, VISITS_JSON, CREATED_AT, UPDATED_AT, FULL_ADDRESS

So client data is **easy to export and move**; the Excel is a full backup and can be re-imported or linked elsewhere using CLIENT_ID / CASE_ID.

---

## Full backup → JSON (everything in one file)

- **Full backup (JSON)** – One button that downloads a single JSON file with **everything** you need to move or restore:
  - **users** – All clients with schedule embedded.
  - **signatures** – All signature records (userId, slot, strokes, signedAt, ip, userAgent). Signature `id` is string in JSON.
  - **routes** – All route definitions (name, color, stopIds).
  - **drivers** – All driver rows (day, name, color, stopIds).
  - **stops** – All stop rows (day, userId, order, address, completed, proofUrl, etc.).
  - **routeRuns** – All route run snapshots (day, createdAt, snapshot JSON).

  **Not included:** City colors (by design). Schedule is embedded in each user.

  **API:** `GET /api/export/backup`. The UI has two options:
  - **Full backup (JSON)** – Fetches the API and triggers a download. The file always includes all six sections (users, signatures, routes, drivers, stops, routeRuns); if a section fails on the server it appears as an empty array.
  - **Backup (open URL)** – Opens the same API URL in a new tab. Use the browser’s **Save As** (e.g. Ctrl+S / Cmd+S) to save the raw JSON. Use this if the download button ever gives you only clients; the API response is the same in both cases.

---

## Other data we keep (and how it connects)

| Data | Where it lives | Ease of move | How to connect |
|------|----------------|---------------|-----------------|
| **Clients (Users)** | `User` table | ✅ Excel export (see above) | CLIENT_ID, CASE_ID link to Unite Us. Internal ID is `User.id`. |
| **Signatures** | `Signature` table | ⚠️ Not in Excel | One row per signature; linked by `userId` → `User.id`. Contains drawing strokes (JSON), signedAt, ip, userAgent. Could add a second sheet “Signatures” or a separate CSV/API. |
| **Schedule** | `Schedule` table (1:1 with User) | ✅ In Excel | Already in the client export as MON–SUN and SCHEDULE_JSON. |
| **City colors** | `CityColor` table | ⚠️ Small table | city → color. No export yet; could add to a “Settings” sheet or API. |
| **Routes** | `Route` table | ⚠️ Reference data | name, color, stopIds (array). Used for planning; could export as JSON or extra sheet. |
| **Drivers** | `Driver` table | ⚠️ Per-day | day, name, color, stopIds. Regenerated per day; not a permanent client list. |
| **Stops** | `Stop` table | ⚠️ Per-day | Daily stop list (address, completed, proofUrl, etc.). Derived from Users + routes for that day. |
| **Route runs** | `RouteRun` table | ⚠️ Historical | Snapshot (JSON) of drivers/stops per run. Good for history; export would be JSON. |
| **Settings** | `Settings` table | ⚠️ Key/value | App settings. Could export as key/value sheet. |

So the only “client” data that’s **not** in the Excel today is **Signatures** (and optionally city colors/routes/settings if you want a single “full backup” file).

---

## Connecting it together

- **Client ↔ Unite Us**  
   Use **CLIENT_ID** and **CASE_ID** from the Excel (or from `User.clientId` / `User.caseId` in the API). The app already uses these for the Unite Us dashboard URL.

2. **Client ↔ Signatures**  
   Signatures are tied to `User.id`. To add signatures to an export, you’d either:
   - Add an API that returns signatures (e.g. `/api/signatures/export`) and merge by `userId`, or
   - Add a second sheet “Signatures” to the Excel with columns like User ID, slot, signedAt, and optionally a “has strokes” flag.

3. **Full backup (all tables)**  
   Possible next steps:
   - An API route (e.g. `GET /api/export/backup`) that returns JSON with: users, signatures, cityColors, routes, settings (and optionally recent RouteRun/Stop snapshots).
   - Or extend the Excel export to multiple sheets: “Users”, “Signatures”, “CityColors”, “Routes”, “Settings”.

If you want, we can add the “Export all + Signatures” sheet or a single backup API next.
