#!/usr/bin/env python3
"""Merge Hive business metrics into the dashboard.

    python3 import_hive.py hive_export.csv
    python3 import_hive.py hive_export.json --dry-run

Reads a CSV/TSV export (or a JSON dump) from Hive, pulls out
lifetime orders + active days per business, and writes src/biz_metrics.json
keyed by business id. build.py then folds that into index.html.

Businesses are matched by id first, then by phone (digits only, last 10),
so exports that only carry a phone number still work.

Column names are matched loosely — "Lifetime Orders", "lifetime_orders",
"Total Orders", "orders" all hit the same field.
"""
from __future__ import annotations

import argparse
import csv
import datetime
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent
DATA_PATH = ROOT / "src" / "biz_data.json"
METRICS_PATH = ROOT / "src" / "biz_metrics.json"

# normalized header -> field
ALIASES = {
    "id": {"businessid", "id", "shopid", "storeid", "merchantid", "business"},
    "name": {"businessname", "name", "shopname", "storename", "merchantname"},
    "phone": {"phone", "phonenumber", "mobile", "mobilenumber", "contact",
              "contactnumber", "businessphone", "phonenumbers"},
    "orders": {"lifetimeorders", "lifetimeorder", "totalorders", "totalorder",
               "orders", "ordercount", "numberoforders", "lifetimeordercount"},
    "days": {"activedays", "activeday", "daysactive", "lifetimeactivedays",
             "activedayscount", "noofactivedays", "active"},
    "distinct": {"distinctorderdays", "distinctdays", "distinctactivedays",
                 "orderdays", "distinctorderdates"},
    "first": {"firstorderdate", "firstorder", "firstorderat", "earliestorder",
              "earliestorderdate", "firstorderdateutc"},
    "last": {"lastorderdate", "lastorder", "lastorderat", "latestorder",
             "latestorderdate", "lastorderdateutc"},
    "revenue": {"lifetimerevenue", "totalrevenue", "revenue", "gmv",
                "lifetimevalue", "totalspend", "lifetimegmv"},
}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def parse_number(v):
    """'1,234' / '৳1 234.50' / '' -> 1234 / 1234.5 / None"""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v) if float(v).is_integer() else float(v)
    s = str(v).strip()
    if not s or s in {"-", "—", "n/a", "N/A", "null", "None"}:
        return None
    s = re.sub(r"[^\d.\-]", "", s.replace(",", ""))
    if s in {"", "-", "."}:
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return int(f) if f.is_integer() else f


def phone_key(p) -> str:
    digits = re.sub(r"\D", "", str(p or ""))
    return digits[-10:] if len(digits) >= 10 else digits


def map_headers(fieldnames):
    mapping = {}
    for raw in fieldnames or []:
        key = norm(raw)
        for field, names in ALIASES.items():
            if field in mapping:
                continue
            if key in names:
                mapping[field] = raw
                break
    return mapping


def rows_from_csv(path: pathlib.Path):
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    sample = text[:8192]
    delimiter = "\t" if path.suffix.lower() in {".tsv", ".txt"} else None
    if delimiter is None:
        try:
            delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
        except csv.Error:
            delimiter = ","
    reader = csv.DictReader(text.splitlines(), delimiter=delimiter)
    return list(reader), reader.fieldnames


def unwrap(payload):
    """Accept list-of-dicts, {'data': [...]}, or {'<id>': {...}} shapes."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("data", "rows", "businesses", "results", "items"):
            if isinstance(payload.get(key), list):
                return payload[key]
        # id -> metrics map
        out = []
        for key, val in payload.items():
            if isinstance(val, dict):
                out.append({"id": key, **val})
            elif isinstance(val, (list, tuple)) and len(val) >= 2:
                out.append({"id": key, "orders": val[0], "days": val[1]})
        if out:
            return out
    raise SystemExit("Could not find a list of businesses in that JSON.")


def to_date(v):
    """'2026-10-28' / '2026-10-28T21:25:45.000Z' -> date, else None."""
    s = str(v or "").strip()
    m = re.match(r"(\d{4}-\d{2}-\d{2})", s)
    if not m:
        return None
    try:
        return datetime.date.fromisoformat(m.group(1))
    except ValueError:
        return None


def active_days(distinct, first, last, explicit):
    """Prefer the explicit number, then distinct order days, then the span."""
    for v in (explicit, distinct):
        n = parse_number(v)
        if n is not None and n > 0:      # 0 means "no dates exported", not "inactive"
            return int(n)
    d1, d2 = to_date(first), to_date(last)
    if d1 and d2 and d2 >= d1:
        return (d2 - d1).days + 1
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Merge Hive metrics into the dashboard.")
    ap.add_argument("source", help="Hive export (.csv, .tsv or .json)")
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    ap.add_argument("--no-build", action="store_true", help="skip re-running build.py")
    args = ap.parse_args()

    src = pathlib.Path(args.source)
    if not src.exists():
        sys.exit(f"No such file: {src}")

    if src.suffix.lower() == ".json":
        records = unwrap(json.loads(src.read_text(encoding="utf-8")))
        mapping = map_headers({k for rec in records[:50] if isinstance(rec, dict) for k in rec})
    else:
        records, fieldnames = rows_from_csv(src)
        mapping = map_headers(fieldnames)

    if "orders" not in mapping and "days" not in mapping:
        sys.exit(
            "Could not find 'lifetime orders' or 'active days' columns.\n"
            f"Detected: {', '.join(mapping.values()) or '(nothing)'}\n"
            "Rename the columns or extend ALIASES in this script."
        )

    biz = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    by_id = {str(r[0]).strip(): str(r[0]) for r in biz}
    by_phone = {phone_key(r[3]): str(r[0]) for r in biz if phone_key(r[3])}

    metrics, hit_id, hit_phone, unmatched = {}, 0, 0, []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        bid = str(rec.get(mapping.get("id", ""), "")).strip()
        target = by_id.get(bid)
        if target:
            hit_id += 1
        else:
            target = by_phone.get(phone_key(rec.get(mapping.get("phone", ""), "")))
            if target:
                hit_phone += 1
        if not target:
            unmatched.append(bid or rec.get(mapping.get("phone", "")) or rec.get(mapping.get("name", "")) or "?")
            continue
        orders = parse_number(rec.get(mapping.get("orders", "")))
        days = active_days(
            rec.get(mapping.get("distinct", "")),
            rec.get(mapping.get("first", "")),
            rec.get(mapping.get("last", "")),
            rec.get(mapping.get("days", "")),
        )
        entry = {"orders": orders, "days": days}
        first, last = to_date(rec.get(mapping.get("first", ""))), to_date(rec.get(mapping.get("last", "")))
        if first:
            entry["first"] = first.isoformat()
        if last:
            entry["last"] = last.isoformat()
        if "revenue" in mapping:
            rev = parse_number(rec.get(mapping["revenue"]))
            if rev is not None:
                entry["revenue"] = rev
        metrics[target] = entry

    matched = len(metrics)
    print(f"Source rows          : {len(records)}")
    print(f"Matched by id        : {hit_id}")
    print(f"Matched by phone     : {hit_phone}")
    print(f"Unique businesses    : {matched} / {len(biz)}")
    print(f"Unmatched source rows: {len(unmatched)}")
    if unmatched:
        print("  first few:", ", ".join(str(u) for u in unmatched[:10]))

    with_orders = sum(1 for m in metrics.values() if m.get("orders") is not None)
    zero_days = sum(1 for m in metrics.values() if m.get("orders") and not m.get("days"))
    with_days = sum(1 for m in metrics.values() if m.get("days"))
    print(f"Rows with active days: {with_days}")
    print(f"Rows with orders     : {with_orders}")
    if zero_days:
        print(f"WARNING: {zero_days} row(s) have orders but no active days -> avg/day blank")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0

    METRICS_PATH.write_text(json.dumps(metrics, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"\nwrote {METRICS_PATH.relative_to(ROOT)}")

    if not args.no_build:
        subprocess.run([sys.executable, str(ROOT / "build.py")], check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
