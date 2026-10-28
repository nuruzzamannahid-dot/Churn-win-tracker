# Churn Win Tracker

Single-file static dashboard for the churn win-back campaign: 540 merchants
(311 churn / 229 inactive) split between the two KAMs, Ahmed Asif Rashid and
Nuruzzaman Nahid.

**Live:** https://churn-win-tracker.vercel.app

## Files

| Path | Purpose |
| --- | --- |
| `src/biz_data.json` | Raw merchant list — `[id, reason, name, phone]` |
| `src/biz_metrics.json` | Hive metrics per business id — `{"359": {"orders":1240,"days":210}}` |
| `src/template.html` | HTML/CSS/JS template with a `__DATA__` placeholder |
| `build.py` | Merges the two JSON files into the template → `index.html` |
| `import_hive.py` | Turns a Hive export (CSV/TSV/JSON) into `src/biz_metrics.json` |
| `index.html` | Built, self-contained dashboard (this is what gets deployed) |
| `apps-script/` | Optional Google Apps Script backend for Google Sheet sync |
| `docs/PASTE-IN-CONSOLE.js` | 6-line loader to paste in the browser console - use this one |
| `docs/hive-orders-pull.js` | Generated console script: pulls lifetime orders + order dates for all 540 businesses |
| `docs/hive-pull.js` | Console snippet that pulls the business list itself (name / phone / active days) |
| `make_hive_script.py` | Regenerates `docs/hive-orders-pull.js` with the business list embedded |
| `test_pagination.js` | Mocked-Hive test for the puller's counting logic (`node test_pagination.js`) |
| `vercel.json` | `cleanUrls`, `trailingSlash`, cache headers |

## Hive metrics (lifetime orders · avg/day)

Two extra table columns come from Hive: **Lifetime orders** and **Avg/day**
(lifetime orders ÷ active days). Active days is kept in the data and shipped in
the CSV export but is not shown as its own column.

They stay **hidden until metrics exist** — an all-empty dashboard looks broken,
so `build.py` only makes them appear once at least one business has numbers.

Partial imports show a **coverage chip** in the table toolbar — `Hive orders 349/540
merchants` — because a dash means *not counted yet*, not *zero orders*. The chip
disappears automatically once every business has an entry.

```bash
python3 import_hive.py hive_export.csv     # writes src/biz_metrics.json, then builds
python3 import_hive.py hive_export.csv --dry-run   # preview the match rate only
```

The importer matches on business id first, then phone (last 10 digits), accepts
`,` `;` and tab delimiters, and tolerates `1,240`, `৳ 45,600` and empty cells.
Column names are matched loosely (`Lifetime Orders`, `lifetime_orders`,
`Total Orders`, `Active Days`, `active_day`…). To teach it new names, edit
`ALIASES` at the top of `import_hive.py`.

### Getting the numbers out of Hive (no API access needed)

> **Pasting into the DevTools console?** Paste `docs/PASTE-IN-CONSOLE.js`
> (6 lines) - it loads the real script for you. Pasting *this README* gives
> `Uncaught SyntaxError: Invalid or unexpected token`, because markdown is not
> JavaScript. The full script starts with `/* Hive -> Churn Win Tracker`.


Hive is a Next.js App Router app: table data arrives as RSC "flight" text, so
there is no copyable JSON in the Network tab. Both helpers below run in your own
browser with your session cookie and never touch your access token.

**Lifetime orders + order dates (the one that fills these columns)**

```bash
python3 make_hive_script.py      # embeds the current 540 businesses
```

Then on `hive.carrybee.com/orders`, open DevTools → Console, paste
`docs/hive-orders-pull.js`, Enter, and `await hiveOrders.run()`. It queries the
`/orders` route once per business by phone, and reports the total, first order
date, last order date and distinct order days. ~4 minutes for 540 businesses.

Guard rails, because a wrong total is worse than no total:

* a **control query** with a nonsense phone must return 0 orders first — if the
  filter is silently ignored, every business would inherit the global total
* each response must mention that business's own phone, otherwise it is flagged
  in the `failed` table rather than written to the CSV
* **the count is the number of distinct order ids across every page**, never the
  page size. The first version reused the page size as the total and reported a
  wall of fake `100`s; Hive exposes no usable `meta.total`, so paginating to a
  short page is the only honest way to count
* **paginates until a short page appears** (`CFG.maxPages` × `CFG.limit` order
  ceiling). If it cannot reach the end, the row is written **blank** and renders
  as `—` rather than as a confident wrong number
* a zero-order business is distinguished from a mis-typed query param by whether
  the response is recognisably an order list (`parseOrders().listLike`)
* distinct order days only comes from a complete page set, so first/last dates
  are real; when pagination stops early nothing is guessed

**Business list / active days as shown in Hive**

`docs/hive-pull.js` pages `/businesses` instead, for when you want Hive's own
active-days figure rather than one derived from order dates.

## Build

```bash
python3 build.py     # rewrites index.html from src/template.html + src/biz_data.json
```

`index.html` is generated. Run the build and commit the result **before** pushing,
otherwise the deployed dashboard keeps showing the old data.

## Deploy

Production URL: https://churn-win-tracker.vercel.app
Vercel project: `churn-win-tracker` (team *Carrybee*)

### How it is currently wired

The Vercel account has no GitHub login connection, so the project cannot be linked
to this repository and builds cannot be triggered by pushes. Deployments are created
through the Vercel API instead; the project's build command fetches the prebuilt page
from this repo's `main` branch into the output directory:

```bash
mkdir -p public \
  && curl -fsSL -o public/index.html https://raw.githubusercontent.com/nuruzzamannahid-dot/Churn-win-tracker/main/index.html \
  && printf 'User-agent: *\nDisallow: /\n' > public/robots.txt
```

Output directory: `public`. Consequences: a redeploy always publishes whatever is on
`main` at that moment, and the build breaks if the repository stops being public.

### Switching to normal Git deploys (recommended)

1. In Vercel, connect your GitHub account (Vercel → Account Settings → Authentication /
   Login Connections → GitHub).
2. Project → Settings → Git → connect `nuruzzamannahid-dot/Churn-win-tracker`.
3. Set Framework Preset to **Other**, clear **Build Command** and **Output Directory**
   (leave defaults), then redeploy — every push to `main` will then publish the
   committed `index.html` with no build step.

The repo already works as a zero-config static site (`index.html` at the root), so
nothing else needs to change.
