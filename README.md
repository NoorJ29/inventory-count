# Inventory Count App

Mobile-friendly barcode inventory counting tool.

- **Counting page** (`/`) — anyone on their phone enters their name, taps **+ Add Item**, scans a barcode with the camera (or types the code manually), confirms the item/UOM and enters the quantity counted, and keeps adding items to a list. Rows can be edited or deleted before submitting. **Submit** sends the whole list to the server.
- **Admin page** (`/admin`, password protected) — shows every submitted row across everyone who's counted (Date, Name, Item Code, Description, UOM, Quantity), with buttons to **export to Excel** and **reset all** (clears the list after a count is finished and exported). Also supports re-uploading a fresh item master list.

This app can run two ways:
1. **Locally** (`npm start`) with data stored as JSON files on disk — see [Running locally](#running-locally). This is also the fast local dev loop for testing changes before deploying.
2. **On Cloudflare Workers** with data stored in Workers KV — see [Deploying to Cloudflare Workers](#deploying-to-cloudflare-workers). This is a separate implementation (`src/workerApp.js` + `src/db/cloudflare.js`, using the [Hono](https://hono.dev) framework instead of Express, since Cloudflare's Workers runtime isn't standard Node.js and can't run Express directly).

## How barcode lookup works

Scanned/typed codes are matched directly against the item's own code (column `No.` in your source file, e.g. `ADIGIND009`), since that's what's physically printed as the barcode. As a bonus fallback, if no item-code match is found it also checks the `Barcode` (EAN/UPC) column, in case some products carry a manufacturer barcode instead — so both styles work if your labeling is ever mixed.

## Setup

```
npm install
```

The item master data was already imported once from `Items (14).xlsx` into `data/items.json` (4,719 active items; blocked/archived items were excluded). To re-import from a new export at any time:

```
npm run import-items "path/to/NewItems.xlsx"
```

...or just use the **Upload Item List** button on the admin page — no restart needed.

## Tests

```
npm test
```

Runs a unit test suite (Node's built-in test runner, no extra dependencies) covering the core business logic: row-merging/grouping, name-capitalization formatting, and count-submission validation (including the client-local-date handling). This doesn't cover the UI itself — verify actual changes by running the app locally too.

## Running locally

Set an admin password (don't skip this — the default is public in the source code):

**PowerShell:**
```powershell
$env:ADMIN_USER = "admin"
$env:ADMIN_PASSWORD = "choose-a-real-password"
npm start
```

**Bash:**
```bash
ADMIN_USER=admin ADMIN_PASSWORD=choose-a-real-password npm start
```

The app listens on `http://localhost:3000` (override with `PORT=xxxx`).

- Counting page: `http://localhost:3000/`
- Admin page: `http://localhost:3000/admin` (browser will prompt for the admin user/password)

## Getting phones to reach it (HTTPS requirement)

Mobile browsers only allow camera access over **HTTPS** or on `localhost` — a plain `http://192.168.x.x:3000` link from another phone on the same WiFi will *not* be able to open the camera, even though the rest of the site works fine. Two ways to fix this:

**Recommended: Cloudflare Tunnel (free, no domain needed)**

1. Install `cloudflared` (see Cloudflare's docs for Windows).
2. With the app running (`npm start`), in another terminal run:
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
3. Cloudflare prints a temporary `https://xxxxx.trycloudflare.com` URL — share that with everyone counting. It's real HTTPS, so the camera scanner works on any phone, on WiFi or mobile data, without you needing to buy hosting or set up certificates. Data still lives only on your own machine (`data/counts.json`, `data/items.json`).
4. Stop the tunnel when the counting session is done; start a fresh one next time (the URL changes each time unless you set up a named/persistent tunnel).

**Alternative:** deploy to Cloudflare Workers instead (below) — you get a permanent HTTPS URL for free, no local machine needs to stay on.

## Deploying to Cloudflare Workers

This runs as a single Cloudflare Worker (`src/workerApp.js`, built with [Hono](https://hono.dev) — Express itself doesn't run on Workers' non-Node.js runtime), serving `public/` as static assets and handling all `/api/*` and `/admin` requests. Data lives in **Workers KV** instead of local JSON files.

Cloudflare's free tier has no commercial-use restriction (unlike Vercel's Hobby plan) and Workers KV is genuinely persistent (unlike ephemeral free-tier storage on platforms like Hugging Face Spaces). Free tier limits: 100,000 requests/day, and on KV specifically 100,000 reads/day but only 1,000 writes, 1,000 deletes, and 1,000 list operations per day — plenty for light-to-moderate use, but worth knowing if a single day ever involves an unusually large number of submissions or a reset of many accumulated batches at once.

### One-time setup

1. Create a [Cloudflare](https://www.cloudflare.com) account if you don't have one.
2. Log in via the CLI (already added as a dev dependency — `npx wrangler` works without a global install):
   ```
   npx wrangler login
   ```
3. Create the KV namespace that stores items and counts:
   ```
   npx wrangler kv namespace create INVENTORY_KV
   ```
   This prints an `id` — copy it into `wrangler.toml`, replacing the placeholder value on the `id = "..."` line under `[[kv_namespaces]]`.
4. Set your admin credentials as Worker secrets (do this before your first deploy):
   ```
   npx wrangler secret put ADMIN_USER
   npx wrangler secret put ADMIN_PASSWORD
   ```
   Each prompts you to type the value — they aren't stored in any committed file.
5. Deploy:
   ```
   npm run cf:deploy
   ```
   Wrangler prints your live URL (e.g. `https://inventory-count.<your-subdomain>.workers.dev`) — that's what you share with everyone counting. Real HTTPS out of the box.

### Loading the item master data

Workers KV starts empty on a new deployment. After your first deploy:

1. Go to `https://<your-worker-url>/admin`, log in with your admin credentials.
2. Use **Upload Item List** to upload your `Items (14).xlsx` (or your latest export). This populates the item master in KV.

Re-run this step any time you have a fresh item export — no redeploy needed.

### Testing before you deploy

```
npm run cf:dev
```
This runs the actual Workers runtime locally (via Wrangler, backed by `workerd` — Cloudflare's real open-source runtime, not a Node.js simulation), including static asset serving, KV storage, and the `/admin` auth gate — a faithful pre-deploy check.

### Things worth knowing about the Cloudflare version

- **Separate codebase for the server side.** `src/workerApp.js` and `src/db/cloudflare.js` mirror every route and behavior from the Express version (`src/app.js` / `src/db/local.js`), but are written specifically for the Workers runtime — changes to routes need to be made in both places to stay in sync. Shared pure logic (validation, grouping, name formatting, export generation) lives in its own module and is imported by both, so that part can't drift.
- **`admin.html` is bundled into the Worker itself** (via a Wrangler "Text" module rule importing `views/admin.html` directly), not placed in the static assets folder — so it's only ever reachable through the authenticated `/admin` route, never by guessing a static file URL.
- **KV write/delete/list caps are 1,000/day each.** Each submission is one KV write; each admin table view is one list + one read per submitted batch; Reset All is one delete per batch. Normal daily use is nowhere near this, but keep it in mind if a single "Reset All" needs to clear an unusually large number of accumulated batches.

## Data & backups

**Local mode:** all data is stored as plain JSON files in `data/`:
- `data/items.json` — item master (code, description, UOM, barcode)
- `data/counts.json` — every submitted count row, until reset

Back these up (just copy the files) before hitting **Export & Reset** on the admin page if you want to keep an archive beyond the Excel export it already downloads.

**Cloudflare mode:** data lives in Workers KV (one key for the item master, one key per submitted batch of counts) — no local files to back up.

## Notes / things worth knowing

- The name entry has no login — it's a free-text name, trusted for an internal counting workflow.
- The counting page keeps your in-progress (not-yet-submitted) list in the phone's local storage, so an accidental refresh won't lose it.
- **Export & Reset** downloads an Excel export first and waits for it to succeed before even asking to confirm deletion — it's not possible to wipe counts without a backup.
- Quantity accepts decimals (e.g. partial units).
