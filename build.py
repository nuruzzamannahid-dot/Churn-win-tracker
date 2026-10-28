#!/usr/bin/env python3
"""Inline src/biz_data.json (+ optional src/biz_metrics.json) into src/template.html -> index.html

Row shape emitted to the page:
    [business_id, reason, name, phone, lifetime_orders, active_days]

Hive metrics live in src/biz_metrics.json, keyed by business id:
    {"359": {"orders": 12, "days": 214}, "24461": [9, 180]}

Either an object ({"orders":..,"days":..}) or a 2-item list [orders, days] is
accepted, so importers can stay dumb. Anything missing becomes null and the
dashboard renders an em dash for it.
"""
import json
import pathlib
import sys

root = pathlib.Path(__file__).parent

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


rows = []
filled = 0
for row in data:
    bid = str(row[0])
    orders, days = pick(metrics.get(bid))
    if orders is not None:
        filled += 1
    rows.append([row[0], row[1], row[2], row[3], orders, days])

raw = json.dumps(rows, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
tpl = (root / "src/template.html").read_text(encoding="utf-8")
if "__DATA__" not in tpl:
    raise SystemExit("placeholder __DATA__ missing from template")
out = tpl.replace("__DATA__", raw)
(root / "index.html").write_text(out, encoding="utf-8")

unknown = sorted(set(metrics) - {str(r[0]) for r in data})
print(f"built index.html - {len(data)} rows, {len(out):,} bytes")
print(f"Hive metrics: {filled}/{len(data)} rows matched")
if unknown:
    print(f"warning: {len(unknown)} metric id(s) not in biz_data.json: {', '.join(unknown[:10])}"
          + (" ..." if len(unknown) > 10 else ""))
