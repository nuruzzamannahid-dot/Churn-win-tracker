#!/usr/bin/env python3
"""Import the compact paste block produced by docs/hive-sweep.js.

    python3 import_paste.py pasted.txt
    pbpaste | python3 import_paste.py -        # read stdin

The block looks like this:

    HIVEPASTE1
    359|262|45;24461|40|2;15954||;...
    HIVEPASTE0

Each entry is `business_id|lifetime_orders|active_days`. Empty fields mean
"could not be counted" and are imported as null so the dashboard shows a dash
rather than a number nobody can defend.

Existing first/last order dates in src/biz_metrics.json are preserved; this
format does not carry dates. Rows whose id is not in biz_data.json are reported
and skipped.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent
DATA_PATH = ROOT / "src" / "biz_data.json"
METRICS_PATH = ROOT / "src" / "biz_metrics.json"

START = "HIVEPASTE1"
END = "HIVEPASTE0"


def read_blob(text: str) -> str:
    """Strip the markers and whitespace, keeping the id|orders|days entries."""
    if START in text:
        text = text.split(START, 1)[1]
    if END in text:
        text = text.split(END, 1)[0]
    text = re.sub(r"-{2,}[^\n]*", "\n", text)          # console banner lines
    text = re.sub(r"%c|color:#[0-9A-Fa-f]{6};?[a-z-]*:?[a-z]*;?", "", text)
    text = re.sub(r"\s+", "", text)                     # chunks were split anywhere
    return text


def parse_entries(blob: str) -> list[tuple[str, str | None, str | None]]:
    out = []
    for chunk in blob.split(";"):
        if not chunk:
            continue
        parts = chunk.split("|")
        if len(parts) < 2:
            continue
        bid = parts[0].strip()
        orders = parts[1].strip() if len(parts) > 1 else ""
        days = parts[2].strip() if len(parts) > 2 else ""
        if not re.fullmatch(r"[A-Za-z0-9_-]+", bid):
            continue
        out.append((bid, orders or None, days or None))
    return out


def to_int(v):
    if v is None:
        return None
    s = re.sub(r"[^\d-]", "", str(v))
    if s in {"", "-"}:
        return None
    try:
        return int(s)
    except ValueError:
        return None


def main() -> int:
    src = sys.argv[1] if len(sys.argv) > 1 else "-"
    raw = sys.stdin.read() if src == "-" else pathlib.Path(src).read_text(encoding="utf-8")

    entries = parse_entries(read_blob(raw))
    if not entries:
        sys.exit("No 'id|orders|days' entries found. Did you paste the whole block "
                 "between HIVEPASTE1 and HIVEPASTE0?")

    biz = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    known = {str(r[0]).strip() for r in biz}

    existing = {}
    if METRICS_PATH.exists():
        try:
            existing = json.loads(METRICS_PATH.read_text(encoding="utf-8")) or {}
        except json.JSONDecodeError:
            existing = {}

    metrics = dict(existing)
    updated = blank = unknown = 0
    for bid, orders_s, days_s in entries:
        if bid not in known:
            unknown += 1
            continue
        orders = to_int(orders_s)
        days = to_int(days_s)
        entry = dict(metrics.get(bid) or {})
        entry["orders"] = orders
        if days is not None and days > 0:
            entry["days"] = days
        elif orders == 0:
            entry["days"] = 0
        if orders is None:
            blank += 1
        else:
            updated += 1
        metrics[bid] = entry

    with_orders = sum(1 for m in metrics.values() if m.get("orders") is not None)
    print(f"Parsed entries        : {len(entries)}")
    print(f"Written with a count  : {updated}")
    print(f"Left blank            : {blank}")
    print(f"Unknown ids (skipped) : {unknown}")
    print(f"Coverage now          : {with_orders} / {len(biz)}")

    METRICS_PATH.write_text(json.dumps(metrics, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"\nwrote {METRICS_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
