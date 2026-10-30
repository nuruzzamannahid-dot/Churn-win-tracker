# Supabase setup

The dashboard no longer carries its 30,507 rows. Data lives in Supabase and the
browser asks for one page at a time, so `index.html` is a ~77 KB shell instead of
a 2.3 MB bundle, and filtering/sorting/paging are indexed queries.

## 1. Create the project

<https://supabase.com> → New project (region **Southeast Asia (Singapore)** is
the closest to Dhaka). Then copy two values from *Project Settings → API Keys*:

- **Project URL** — `https://<ref>.supabase.co`
- **anon public** key — the long `eyJ…` JWT. Newer dashboards list it under
  *Legacy API keys*; the `sb_publishable_…` key works too. Do **not** use
  `service_role`.

> Use the `anon` key only. The `service_role` key bypasses row level security —
> anything pasted into the page is readable by anyone who opens it.

## 2. Create the schema

The project URL and the publishable (anon) key are already baked into the page,
so a fresh browser connects with no setup. To point the app at a different
project, use the connect dialog — values saved there win over the shipped
defaults.

SQL → New query → paste all of `supabase/schema.sql` → Run.

That creates:

| Object | Purpose |
| --- | --- |
| `businesses` | One row per business, with the current call state (`kam`, `outcome`, `notes`, `updated_at`) denormalised onto it so the table never joins |
| `call_log` | Append-only audit trail, written by a trigger when an outcome changes |
| `v_dashboard` | One row with every aggregate the panels need — KPIs, KAM board, donut, projection |
| `v_export` | Sheet-shaped view with avg orders/day computed |
| indexes | `lifetime_orders desc nulls last`, `(kam, outcome)`, `(hive_churn, lifetime_orders)`, trigram on `name`/`phone` |
| policies | `anon` can read everything and update **only** `kam`, `outcome`, `notes` |

## 2b. Clear the security advisor

Run `supabase/hardening.sql` once. It fixes the two findings that matter:

- **Security Definer View** on `v_dashboard` / `v_export` — Postgres creates
  views as the owner by default, so they would bypass row level security for
  anon. `security_invoker = on` makes them run as the caller.
- **Function Search Path Mutable** on `log_call_change()` — pins `search_path`
  so a caller-controlled schema cannot hijack the trigger.

`RLS Policy Always True` on `businesses` is **deliberate** and will stay in the
list: this is an internal tool driven by the public anon key. The column-level
grant is what limits the damage — anon can update `kam`/`outcome`/`notes` and
nothing else. `Extension in Public` (`pg_trgm`) is low risk and the fix is
commented out at the bottom of `hardening.sql`.

## 3. Load the data

```bash
python3 supabase/import.py                                  # writes supabase/businesses.csv
python3 supabase/import.py --push https://<ref>.supabase.co <anon-key>
```

`import.py` reproduces the old `build.py` figures exactly — the order counts and
per-merchant run rates will match what the dashboard showed before the move. It
is safe to re-run: uploads merge on the primary key and **do not touch**
`kam`/`outcome`/`notes`, so live call work is never overwritten.

Prefer no terminal? Import the CSV from the Studio:

1. `python3 supabase/import.py` writes `supabase/businesses.csv` (30,507 rows, ~2.2 MB)
2. Supabase → **Table Editor → businesses → Insert → Import data from CSV**
3. Pick the file, keep the header row, and confirm the column mapping
   (`lifetime_orders`, `active_days`, `orders_per_month` → numeric,
   `is_estimated` / `hive_churn` → boolean)

`\copy` only works in `psql`; the web SQL editor does not run it.

## 4. Connect the dashboard

Nothing to do — the shipped URL and publishable key connect on load. To override
them (another project, or a damaged `localStorage`), click the pill in the header
and press **Save & connect**.

## What "load management" means here

- The list is fetched one page at a time (`limit` / `offset`), with the filtered
  total read from the `Content-Range` header.
- The six KPI cards, KAM board, donut and projection come from **one**
  `v_dashboard` request — the browser never walks the table for them.
- A superseded page request is aborted, so fast typing in the search box cannot
  queue up stale queries.
- Search is debounced (250 ms) and typed as a single indexed `ILIKE`.
- A row edit is one `PATCH` touching one row; the aggregates are then re-read.
- The page refreshes every 20 s while visible, plus on focus/visibility change,
  but never while a note field has focus.
- "All / page" is capped at 1,000 rows; use **Export CSV** for the full set
  (it pages through 1,000 at a time).

## Security notes

- Anyone holding the anon key can read every merchant's name, phone and call
  history, and can update the three call columns. That matches how the Google
  Sheet version worked, but it is now reachable from the public URL.
- If that is too open, enable Supabase Auth and change the two policies in
  `schema.sql` from `to anon` to `to authenticated`, then add a sign-in step.
- Row level security is on; the column-level `GRANT` is what stops anon from
  rewriting names, phones or order counts.

## Tests

Install the DOM dependency once: `npm install jsdom` (it is not committed).

`node test_db.js` (48 checks) exercises the data layer against a miniature
PostgREST, and `node test_ui.js` (35 checks) drives the real `index.html` against
the same mock: paging, sorting, filters, writes and the KPI refresh.
`python3 test_schema.py` parses the SQL with the real Postgres grammar (needs
`pglast`). None of them need a Supabase account or network access.
