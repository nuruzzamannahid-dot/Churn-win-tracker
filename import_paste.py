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
DSTART = "HIVEDATES1"          # docs/hive-dates.js, adds first/last order dates
DEND = "HIVEDATES0"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def read_blob(text: str) -> str:
    """Strip the markers and whitespace, keeping the id|orders|days[|first|last] entries."""
    for start, end in ((DSTART, DEND), (START, END)):
        if start in text:
            text = text.split(start, 1)[1]
        if end in text:
            text = text.split(end, 1)[0]
    text = re.sub(r"-{2,}[^\n]*", "\n", text)          # console banner lines
    text = re.sub(r"%c|color:#[0-9A-Fa-f]{6};?[a-z-]*:?[a-z]*;?", "", text)
    text = re.sub(r"\s+", "", text)                     # chunks were split anywhere
    return text


def clean_date(v: str | None) -> str | None:
    if not v:
        return None
    v = v.strip()
    return v if DATE_RE.match(v) else None


def parse_entries(blob: str) -> list[tuple[str, str | None, str | None, str | None, str | None]]:
    """-> (id, orders, days, first, last).

    The 5-field form comes from docs/hive-dates.js; the 3-field form from
    docs/hive-min.js. Trailing fields are optional so both parse.
    """
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
        first = clean_date(parts[3]) if len(parts) > 3 else None
        last = clean_date(parts[4]) if len(parts) > 4 else None
        if first and last and first > last:      # a reversed range is not usable
            first = last = None
        if not re.fullmatch(r"[A-Za-z0-9_-]+", bid):
            continue
        out.append((bid, orders or None, days or None, first, last))
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
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    dry = any(a in ("--dry", "--dry-run", "-n") for a in sys.argv[1:])
    src = args[0] if args else "-"
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
    updated = blank = unknown = kept = dated = 0
    changed: list[tuple[str, int, int]] = []
    for bid, orders_s, days_s, first_s, last_s in entries:
        if bid not in known:
            unknown += 1
            continue
        orders = to_int(orders_s)
        days = to_int(days_s)
        entry = dict(metrics.get(bid) or {})

        if orders is None:
            # A blank means "this run could not count it", which is not evidence
            # that an earlier count was wrong. Keep whatever we already had, so a
            # 429 or a filtered-out response never erases a good number.
            blank += 1
            if entry.get("orders") is not None:
                kept += 1
            entry.setdefault("orders", None)
        else:
            before = entry.get("orders")
            entry["orders"] = orders
            if days is not None and days > 0:
                entry["days"] = days
            elif orders == 0:
                entry["days"] = 0
            if first_s and last_s:
                if entry.get("first") != first_s or entry.get("last") != last_s:
                    dated += 1
                entry["first"], entry["last"] = first_s, last_s
            if before is not None and before != orders:
                changed.append((bid, before, orders))
            updated += 1

        metrics[bid] = entry

    with_orders = sum(1 for m in metrics.values() if m.get("orders") is not None)
    print(f"Parsed entries        : {len(entries)}")
    print(f"Written with a count  : {updated}")
    print(f"Left blank            : {blank}"
          + (f"  ({kept} kept an earlier count)" if kept else ""))
    print(f"Unknown ids (skipped) : {unknown}")
    if dated:
        print(f"Order dates written   : {dated}")
    print(f"Coverage now          : {with_orders} / {len(biz)}")

    if changed:
        print(f"Changed vs before     : {len(changed)}"
              f" (largest: {max(changed, key=lambda c: abs(c[2] - c[1]))[0]})")

    # Sanity: a count that cannot be true is worth seeing before it ships.
    odd = [(k, v) for k, v in metrics.items()
           if v.get("orders") not in (None, 0)
           and (v.get("days") == 0 or (v.get("days") or 0) > v["orders"])]
    if odd:
        print(f"Suspicious rows       : {len(odd)}  e.g. {odd[:3]}")
    else:
        print("Suspicious rows       : 0")

    if dry:
        print("\n--dry: nothing written")
        return 0

    METRICS_PATH.write_text(json.dumps(metrics, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"\nwrote {METRICS_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
