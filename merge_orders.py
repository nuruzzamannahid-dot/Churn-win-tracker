#!/usr/bin/env python3
"""Merge Hive order CSVs into src/biz_metrics.json.

The puller (docs/hive-orders-pull-min.js) writes columns:
    Business ID, Business Name, Phone, Total Orders,
    First Order Date, Last Order Date, Distinct Order Days

Old pulls and hand-fixed files use the same header, sometimes with a BOM,
sometimes quoted names. Any CSV with a "Business ID" and "Total Orders"
column in any order/position is accepted, and multiple files can be merged
in one go (later files win where they are more complete).

Merge rules — a blank must never erase a known count or known dates:
  * a row with a non-numeric / empty Total Orders is skipped entirely
  * an existing order count is only replaced when the incoming one is higher
    (lifetime orders only ever grow), unless --force is passed
  * Distinct Order Days is only written when it is greater than 0
  * dates are only written when non-empty
  * a capped row (Total Orders == the 500-row page cap with 0 distinct days)
    keeps its count but never contributes dates, because those dates only
    cover the first page and would corrupt Avg order / day

Usage:
    python3 merge_orders.py hive_orders_all.csv
    python3 merge_orders.py batch1.csv batch2.csv --build
    python3 merge_orders.py pulled.csv --force      # trust the file completely
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).parent
METRICS = ROOT / "src/biz_metrics.json"
ALL_ORDERS = ROOT / "src/biz_all_orders.json"
PAGE_CAP = 500          # rows per Hive request in the puller

ID_KEYS = ("business id", "business_id", "id")
ORDER_KEYS = ("total orders", "lifetime orders", "orders", "order count")
DAY_KEYS = ("distinct order days", "order days", "active days", "days")
FIRST_KEYS = ("first order date", "first")
LAST_KEYS = ("last order date", "last")


def pick(row: dict, keys: tuple[str, ...]) -> str:
    norm = {str(k).strip().lstrip("\ufeff").lower(): v for k, v in row.items() if k is not None}
    for k in keys:
        if k in norm and norm[k] not in (None, ""):
            return str(norm[k]).strip()
    return ""


def as_int(text: str):
    t = (text or "").replace(",", "").strip()
    if not t or t in {"-", "—", "–"}:
        return None
    try:
        return int(float(t))
    except ValueError:
        return None


def as_date(text: str):
    t = (text or "").strip()
    if not t:
        return None
    t = t[:10]
    try:
        return dt.date.fromisoformat(t).isoformat()
    except ValueError:
        return None


def read_csv(path: pathlib.Path) -> list[dict]:
    for enc in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            with open(path, newline="", encoding=enc) as fh:
                rows = list(csv.DictReader(fh))
            if rows and any("business" in str(k).lower() or "id" == str(k).strip().lower()
                            for k in rows[0]):
                return rows
        except UnicodeDecodeError:
            continue
    sys.exit(f"{path.name}: could not read as CSV with a Business ID column")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("csvs", nargs="+", type=pathlib.Path)
    ap.add_argument("--force", action="store_true",
                    help="let incoming values overwrite existing ones unconditionally")
    ap.add_argument("--build", action="store_true", help="run build.py afterwards")
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    args = ap.parse_args()

    metrics: dict = json.loads(METRICS.read_text(encoding="utf-8")) or {}
    known = {str(r[0]) for r in json.loads(ALL_ORDERS.read_text(encoding="utf-8"))}
    before = len(metrics)

    stats = {"rows": 0, "applied": 0, "new": 0, "kept": 0, "blank": 0,
             "no_dates": 0, "unknown": 0, "capped": 0}

    for path in args.csvs:
        if not path.exists():
            sys.exit(f"{path}: not found")
        rows = read_csv(path)
        print(f"{path.name}: {len(rows):,} rows")
        for row in rows:
            stats["rows"] += 1
            bid = pick(row, ID_KEYS)
            if not bid:
                stats["blank"] += 1
                continue
            if bid not in known:
                stats["unknown"] += 1
                continue
            orders = as_int(pick(row, ORDER_KEYS))
            if orders is None or orders < 0:
                stats["blank"] += 1          # never let a blank erase a known count
                continue

            days = as_int(pick(row, DAY_KEYS)) or 0
            first = as_date(pick(row, FIRST_KEYS))
            last = as_date(pick(row, LAST_KEYS))
            capped = orders >= PAGE_CAP and days == 0
            if capped:
                stats["capped"] += 1

            cur = metrics.get(bid) or {}
            cur_orders = cur.get("orders")
            take = args.force or cur_orders is None or orders > cur_orders
            if not take:
                stats["kept"] += 1
                # still backfill dates/active days if we have none at all
                if cur.get("days") is None and days > 0:
                    cur["days"] = days
                if cur.get("first") is None and first and not capped:
                    cur["first"] = first
                if cur.get("last") is None and last and not capped:
                    cur["last"] = last
                metrics[bid] = cur
                continue

            if bid not in metrics:
                stats["new"] += 1
            entry = dict(cur)
            entry["orders"] = orders
            if days > 0:
                entry["days"] = days
            elif "days" not in entry:
                entry["days"] = None
            if first and last and not capped:
                entry["first"] = first
                entry["last"] = last
            elif not capped and not entry.get("first"):
                stats["no_dates"] += 1
            metrics[bid] = entry
            stats["applied"] += 1

    with_counts = sum(1 for v in metrics.values() if v.get("orders") is not None)
    print()
    print(f"rows read        {stats['rows']:,}")
    print(f"applied          {stats['applied']:,}  (of which new: {stats['new']:,})")
    print(f"kept existing    {stats['kept']:,}  (incoming count was not higher)")
    print(f"skipped blank    {stats['blank']:,}  (no usable order count)")
    print(f"capped rows      {stats['capped']:,}  (count kept, dates ignored)")
    print(f"unknown ids      {stats['unknown']:,}  (not in the 30,507 business list)")
    print(f"metrics          {before:,} -> {len(metrics):,} businesses, "
          f"{with_counts:,} with an order count")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0

    METRICS.write_text(json.dumps(metrics, ensure_ascii=False, indent=0, sort_keys=True) + "\n",
                       encoding="utf-8")
    print(f"wrote {METRICS.relative_to(ROOT)}")

    if args.build:
        import subprocess
        print("\nrunning build.py …")
        return subprocess.call([sys.executable, str(ROOT / "build.py")])
    print("\nnext: python3 build.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
