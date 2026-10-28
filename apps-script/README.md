# Google Sheet sync — setup (5 minutes, one time)

The dashboard writes every **Assigned KAM / Outcome / Notes / Updated** change
straight into your sheet, and reads the other KAM's changes back. It does this
through a small **Apps Script Web App** that lives inside the spreadsheet — no
API keys, no database, no server of your own.

```
Dashboard (Vercel)  ──POST/GET──▶  Apps Script Web App  ──▶  Google Sheet
                    ◀──pulls────                     ◀──   columns E–H
```

Why this design: a static page can't hold Google credentials safely. Apps
Script runs *as you*, inside the sheet, so nothing secret ever ships to the browser.

---

## Step 1 — Add the script to the sheet

1. Open **Churn & Inactive merchant List**
2. **Extensions → Apps Script**
3. Delete whatever is in `Code.gs`, paste **this folder's `Code.gs`**
4. **Save** (💾)

The file already points at the right spreadsheet:

```js
var SPREADSHEET_ID = '1X0ILBCnzOp8xAGmvCyE5GuIt7wzr-r8K7DgQZsqWieY';
var SHEET_NAME = 'Sheet1';
```

## Step 2 — Deploy as a Web App

1. **Deploy → New deployment**
2. Gear icon → **Web app**
3. **Description:** `Churn tracker sync`
4. **Execute as:** `Me (your@email)`
5. **Who has access:** **Anyone**  ← must be *Anyone*, not "Anyone with Google account"
6. **Deploy** → authorise when prompted (it will ask for permission to edit that sheet — expected)
7. Copy the **Web app URL** — it ends in `/exec`

> "Anyone" here means *anyone holding this unguessable URL*, not the public web.
> It only exposes this one sheet through the routes below.

## Step 3 — Connect the dashboard

1. Open the dashboard → click the **Sheet sync** pill in the header
2. Paste the `/exec` URL → **Save & connect**
3. It should immediately say **Synced** and show `Connected · last synced just now`

First time only, click **Push all local** if any calls were already logged on
that device — that seeds the sheet.

---

## What gets written

| Column | Field | Example |
|---|---|---|
| A | Business ID *(already there)* | `359` |
| B | Reason *(already there)* | `Churn` |
| C | Business Name *(already there)* | `Aladeener Cherag` |
| D | Phone *(already there)* | `8801836102283` |
| **E** | **Assigned KAM** | `Ahmed Asif Rashid` |
| **F** | **Outcome** | `Won back` |
| **G** | **Notes** | `Asked to call after Eid` |
| **H** | **Updated** | `2026-10-28T14:35:49.783Z` |
| **I** | **Lifetime orders** | `678` |
| **J** | **Avg order / day** | `23.38` |

Rows are matched by **Business ID**, so the order of rows in the sheet doesn't matter.

**Average order** here means *orders per active day* — lifetime orders divided by
the number of distinct days the merchant ordered. It is not an order value in
৳, and not orders per month.

Columns E–H fill in as KAMs work through the list. Columns I–J are order data
that comes from Hive, not from anyone's edits, so they are written two ways:

- automatically with every E–H write, so a merchant is always complete
- in one go by **Push orders** in the dashboard's Sheet-sync dialog, which walks
  all 540 merchants in batches of 100 and writes only I–J

`Push orders` sends `{id, orders, avg}` and nothing else, and the Apps Script
only writes the columns an update actually carries — so it can never blank
someone's outcome or notes.

## How syncing behaves

- Every edit is **saved locally instantly**, then queued for the sheet within ~1 second
- If the sheet is unreachable, the pill turns **Sync error** and the change stays
  queued; it retries every 6 seconds until it lands — nothing is lost
- The dashboard **pulls automatically** every 45 seconds (and when you return to the tab),
  so both KAMs converge on one shared state
- Conflict rule: **newest `Updated` timestamp wins** per merchant
- **Disconnect** in the settings dialog stops all writing; local data is untouched

## Endpoints exposed by the web app

| Route | Purpose |
|---|---|
| `GET  …/exec?action=ping` | connection test → `{ok, sheet, rows}` |
| `GET  …/exec?action=rows` | all tracker rows → `{ok, rows:[[id,kam,outcome,notes,updated]]}` |
| `POST …/exec` | body `{updates:[{id,kam,outcome,notes,updated,orders,avg}]}` → writes whichever of E–J each update carries |

Test it in a terminal:

```bash
curl -L "https://script.google.com/macros/s/…/exec?action=ping"
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Pill stuck on **Sync error** | Re-copy the `/exec` URL; make sure access is **Anyone** |
| "Could not read the sheet" | You edited `Code.gs` but didn't deploy a **new version** (`Deploy → Manage deployments → ✏️ → Version: New version`) |
| Nothing appears in E–H | Business IDs in column A must match the dashboard's IDs; check `↑ Push all local` |
| Writes slow for big batches | Normal for Apps Script (≈1s per 100 rows); the queue handles it |

## Re-deploying after editing `Code.gs`

`Deploy → Manage deployments → ✏️ (edit) → Version: **New version** → Deploy`.
The `/exec` URL stays identical, so the dashboard keeps working.
