#!/usr/bin/env python3
"""Build the seed file for Supabase from the existing data sources.

    python3 supabase/import.py                 # writes supabase/businesses.csv
    python3 supabase/import.py --push URL KEY  # also uploads it in batches

Sources (same ones build.py used):
    src/biz_data.json               540 sheet rows  [id, reason, name, phone]
    src/biz_metrics.json            Hive order data per business id
    src/hive_churn_30plus_days.csv  Hive's own churn list (authoritative)

Rate maths is identical to the old build.py so the dashboard numbers do not
move: orders / months-spanned, or an active-day estimate when dates are
missing. A business with no order count keeps lifetime_orders NULL — a blank
must never be turned into a zero.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import pathlib
import statistics
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "supabase" / "businesses.csv"

SPAN_MIN_DAYS = 30
DAYS_PER_MONTH = 30.44
BATCH = 500


def load_json(p: pathlib.Path, default):
    if not p.exists():
        return default
    return json.loads(p.read_text(encoding="utf-8")) or default


def span_months(entry: dict):
    first, last = entry.get("first"), entry.get("last")
    if not (first and last):
        return None
    try:
        span = (dt.date.fromisoformat(last) - dt.date.fromisoformat(first)).days
    except (TypeError, ValueError):
        return None
    return max(span, SPAN_MIN_DAYS) / DAYS_PER_MONTH


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--push", nargs=2, metavar=("URL", "ANON_KEY"),
                    help="upload to Supabase after writing the CSV")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    sheet = load_json(ROOT / "src/biz_data.json", [])
    metrics = load_json(ROOT / "src/biz_metrics.json", {})

    churn = {}
    churn_csv = ROOT / "src/hive_churn_30plus_days.csv"
    if churn_csv.exists():
        with open(churn_csv, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                bid = (row.get("business_id") or "").strip()
                if bid:
                    churn[bid] = {
                        "name": (row.get("business_name") or "").strip(),
                        "phone": (row.get("business_phone") or "").strip(),
                    }

    # Calibrate the undated estimate on merchants that do have dates.
    ratios = []
    for entry in metrics.values():
        if not isinstance(entry, dict):
            continue
        months, days = span_months(entry), entry.get("days")
        if months and days and days > 0:
            ratios.append(months / days)
    months_per_active_day = statistics.median(ratios) if ratios else 1 / 4

    rows, seen = [], set()

    def add(bid, reason, name, phone):
        if bid in seen:
            return
        seen.add(bid)
        entry = metrics.get(bid) if isinstance(metrics.get(bid), dict) else {}
        orders = entry.get("orders")
        days = entry.get("days")
        first, last = entry.get("first"), entry.get("last")

        m30 = entry.get("m30")
        if not isinstance(m30, int):
            m30 = None

        per_month, estimated = None, False
        if orders is not None:
            months = span_months(entry)
            estimated = months is None
            if estimated:
                months = max((days or 0) * months_per_active_day, 0.5)
            per_month = round(orders / months, 2)

        rows.append({
            "id": bid,
            "reason": reason,
            "name": name,
            "phone": phone,
            "lifetime_orders": "" if orders is None else orders,
            "active_days": "" if days is None else days,
            "orders_per_month": "" if per_month is None else per_month,
            "is_estimated": "true" if estimated else "false",
            "orders_30d": "" if m30 is None else m30,
            "last_order_date": last or "",
            "hive_churn": "true" if bid in churn else "false",
            "kam": "ahmed" if len(rows) % 2 == 0 else "nahid",
            "outcome": "pending",
            "notes": "",
        })

    for row in sheet:
        add(str(row[0]), row[1], row[2], row[3])

    for bid in sorted(churn):
        add(bid, "Churn", churn[bid]["name"], churn[bid]["phone"])

    fields = ["id", "reason", "name", "phone", "lifetime_orders", "active_days",
              "orders_per_month", "orders_30d", "is_estimated", "last_order_date",
              "hive_churn", "kam", "outcome", "notes"]
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r[k] for k in fields})

    counted = sum(1 for r in rows if r["lifetime_orders"] != "")
    print(f"wrote {out.relative_to(ROOT)} — {len(rows):,} businesses, "
          f"{counted:,} with an order count, {len(rows) - counted:,} unknown")

    if args.push:
        url, key = args.push
        push(url, key, rows)
    else:
        print("\nLoad it into Supabase either way:")
        print("  SQL editor:  \\copy public.businesses from 'businesses.csv' csv header")
        print("  or:          python3 supabase/import.py --push https://<ref>.supabase.co <anon-key>")
    return 0


def push(url: str, key: str, rows: list[dict]) -> None:
    """Bulk upsert through PostgREST. Safe to re-run: it merges on the primary key
    and only touches the task columns, so existing notes and outcomes survive."""
    import urllib.error
    import urllib.request

    endpoint = url.rstrip("/") + "/rest/v1/businesses?on_conflict=id"
    task_cols = {"kam", "outcome", "notes"}
    payload_rows = [{k: v for k, v in r.items() if k not in task_cols} for r in rows]
    sent = 0
    for i in range(0, len(payload_rows), BATCH):
        chunk = payload_rows[i:i + BATCH]
        body = json.dumps(chunk).encode("utf-8")
        req = urllib.request.Request(endpoint, data=body, method="POST", headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                if res.status >= 300:
                    raise RuntimeError(f"HTTP {res.status}")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:400]
            sys.exit(f"upload failed at row {i}: HTTP {exc.code} — {detail}")
        sent += len(chunk)
        print(f"  uploaded {sent:,}/{len(payload_rows):,}", flush=True)
    print("done — existing kam/outcome/notes were left untouched")


if __name__ == "__main__":
    raise SystemExit(main())
