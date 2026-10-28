#!/usr/bin/env python3
"""Inline src/biz_data.json (+ optional src/biz_metrics.json) into src/template.html -> index.html

Row shape emitted to the page:
    [business_id, reason, name, phone, lifetime_orders, active_days,
     orders_per_month, is_estimated]

orders_per_month is the historical run rate used by the projection panel. It is
only measurable where order dates exist: a merchant capped at 100 orders by the
old puller had its "first"/"last" taken from that first page, so those dates do
not cover the same window as the order count. Undated merchants get an estimate
from their active-day count and are flagged, so the page can say which numbers
are measured and which are guessed.

Hive metrics live in src/biz_metrics.json, keyed by business id:
    {"359": {"orders": 12, "days": 214}, "24461": [9, 180]}

Either an object ({"orders":..,"days":..}) or a 2-item list [orders, days] is
accepted, so importers can stay dumb. Anything missing becomes null and the
dashboard renders an em dash for it.
"""
import datetime as dt
import json
import pathlib
import statistics
import sys

root = pathlib.Path(__file__).parent

SPAN_MIN_DAYS = 30        # a merchant seen for under a month is treated as one month
DAYS_PER_MONTH = 30.44

data = json.loads((root / "src/biz_data.json").read_text(encoding="utf-8"))

metrics_path = root / "src/biz_metrics.json"
metrics = {}
if metrics_path.exists():
    try:
        metrics = json.loads(metrics_path.read_text(encoding="utf-8")) or {}
    except json.JSONDecodeError as exc:
        sys.exit(f"src/biz_metrics.json is not valid JSON: {exc}")


def pick(entry):
    """-> (orders, days) as ints/floats or None."""
    if entry is None:
        return None, None
    if isinstance(entry, dict):
        return entry.get("orders"), entry.get("days")
    if isinstance(entry, (list, tuple)):
        orders = entry[0] if len(entry) > 0 else None
        days = entry[1] if len(entry) > 1 else None
        return orders, days
    return None, None


def span_months(entry):
    """Calendar months covered by the order dates, or None when they are absent."""
    first = (entry or {}).get("first")
    last = (entry or {}).get("last")
    if not (first and last):
        return None
    try:
        span = (dt.date.fromisoformat(last) - dt.date.fromisoformat(first)).days
    except (TypeError, ValueError):
        return None
    return max(span, SPAN_MIN_DAYS) / DAYS_PER_MONTH


# Calibrate the undated estimate on the merchants that do have dates, rather than
# hard-coding a constant: months ~= active_days * c.
_ratios = []
for entry in metrics.values():
    if not isinstance(entry, dict):
        continue
    months, days = span_months(entry), entry.get("days")
    if months and days and days > 0:
        _ratios.append(months / days)
MONTHS_PER_ACTIVE_DAY = statistics.median(_ratios) if _ratios else 1 / 4

rows = []
filled = 0
measured = estimated = 0
for row in data:
    bid = str(row[0])
    orders, days = pick(metrics.get(bid))
    if orders is not None:
        filled += 1

    entry = metrics.get(bid) if isinstance(metrics.get(bid), dict) else {}
    months = span_months(entry)
    is_estimate = False
    if months is None:
        is_estimate = True
        months = max((days or 0) * MONTHS_PER_ACTIVE_DAY, 0.5)

    per_month = None
    if orders is not None:
        per_month = round(orders / months, 2)
        if is_estimate:
            estimated += 1
        else:
            measured += 1

    rows.append([row[0], row[1], row[2], row[3], orders, days, per_month,
                 1 if is_estimate else 0])

raw = json.dumps(rows, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
tpl = (root / "src/template.html").read_text(encoding="utf-8")
if "__DATA__" not in tpl:
    raise SystemExit("placeholder __DATA__ missing from template")
out = tpl.replace("__DATA__", raw)
(root / "index.html").write_text(out, encoding="utf-8")

unknown = sorted(set(metrics) - {str(r[0]) for r in data})
print(f"built index.html - {len(data)} rows, {len(out):,} bytes")
print(f"Hive metrics: {filled}/{len(data)} rows matched")
print(f"run rate     : {measured} measured from order dates, {estimated} estimated from active days")
if unknown:
    print(f"warning: {len(unknown)} metric id(s) not in biz_data.json: {', '.join(unknown[:10])}"
          + (" ..." if len(unknown) > 10 else ""))
