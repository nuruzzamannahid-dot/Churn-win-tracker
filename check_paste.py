#!/usr/bin/env python3
"""Audit a pasted sweep block before importing it.

    python3 check_paste.py pasted.txt

Checks the block against the real business list and the counts already in
src/biz_metrics.json. Writes nothing. Exit code 1 means do not import.

The cross-check matters: 349 of the 540 counts are already known and exact, so
a pasted block that disagrees with many of them is a corrupted copy, not a
better measurement.
"""
from __future__ import annotations

import collections
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent
sys.path.insert(0, str(ROOT))

import import_paste  # noqa: E402  (reuse the exact same parser)

DATA_PATH = ROOT / "src" / "biz_data.json"
METRICS_PATH = ROOT / "src" / "biz_metrics.json"

EXPECTED = 540            # full sweep: businesses in biz_data.json
EXPECTED_CHARS = 6232     # blob length reported by the sweep console
EXPECTED_BLANK = 0
# A dates backfill (docs/hive-dates.js) reports far fewer rows, so the sizes are
# overridable: python3 check_paste.py block.txt --expect 191 --chars 2900


def main() -> int:
    argv = sys.argv[1:]
    expect, expect_chars = EXPECTED, EXPECTED_CHARS
    rest = []
    i = 0
    while i < len(argv):
        if argv[i] in ("--expect", "--chars") and i + 1 < len(argv):
            if argv[i] == "--expect":
                expect = int(argv[i + 1])
            else:
                expect_chars = int(argv[i + 1])
            i += 2
            continue
        rest.append(argv[i])
        i += 1

    src = rest[0] if rest else "-"
    raw = sys.stdin.read() if src == "-" else pathlib.Path(src).read_text(encoding="utf-8")

    # `copy(window.__hiveBlob)` yields the bare block with no markers; selecting
    # the console output yields markers plus wrapped lines. Both are accepted.
    if import_paste.START in raw or import_paste.DSTART in raw:
        blob = import_paste.read_blob(raw)
    else:
        blob = re.sub(r"\s+", "", raw)
        print("note: no marker — treating the whole paste as the block")

    if not re.fullmatch(r"[A-Za-z0-9_|;-]+", blob):
        stray = sorted(set(re.sub(r"[A-Za-z0-9_|;-]", "", blob)))[:10]
        print(f"FAIL  unexpected characters in the block: {stray}")
        print(f"      first 80 chars: {blob[:80]!r}")
        return 1
    entries = import_paste.parse_entries(blob)

    biz = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    known = {str(r[0]).strip(): str(r[2]) for r in biz}
    existing = json.loads(METRICS_PATH.read_text(encoding="utf-8")) if METRICS_PATH.exists() else {}

    problems: list[str] = []
    warnings: list[str] = []

    # --- structure -------------------------------------------------------
    ids = [e[0] for e in entries]
    dupes = [k for k, v in collections.Counter(ids).items() if v > 1]
    unknown = [i for i in ids if i not in known]
    blanks = [e for e in entries if e[1] is None]

    print(f"entries         : {len(entries)}  (expected {expect})")
    print(f"blob characters : {len(blob)}  (console said {expect_chars})")
    print(f"blank counts    : {len(blanks)}  (expected {EXPECTED_BLANK})")
    print(f"duplicate ids   : {len(dupes)}")
    print(f"unknown ids     : {len(unknown)}")

    if len(entries) != expect:
        problems.append(f"{len(entries)} entries, expected {expect}")
    if len(blob) != expect_chars:
        problems.append(f"blob is {len(blob)} chars but the console printed {expect_chars}")
    if len(blanks) != EXPECTED_BLANK:
        problems.append(f"{len(blanks)} blank counts, console said {EXPECTED_BLANK}")
    if dupes:
        problems.append(f"duplicated ids: {dupes[:5]}")
    if unknown:
        problems.append(f"ids not in the business list: {unknown[:5]}")

    # --- plausibility ----------------------------------------------------
    bad = []
    for bid, o, d, _f, _l in entries:
        oi, di = import_paste.to_int(o), import_paste.to_int(d)
        if oi is not None and oi < 0:
            bad.append((bid, "negative orders"))
        if di is not None and oi is not None and di > oi:
            bad.append((bid, f"days {di} > orders {oi}"))
    if bad:
        problems.append(f"impossible rows: {bad[:5]}")

    # --- cross-check against the counts we already trust -----------------
    dated = [e for e in entries if e[3] and e[4]]
    is_dates_run = import_paste.DSTART in raw
    print(f"with order dates: {len(dated)} of {len(entries)}")
    # A hive-min.js block carries no dates at all, so this only matters when the
    # block is meant to supply them.
    if is_dates_run and len(dated) < len([e for e in entries if e[1] is not None]):
        problems.append(
            f"{len(entries) - len(dated)} swept merchant(s) came back without dates")

    same = differ = new = 0
    diffs = []
    for bid, o, _d, _f, _l in entries:
        oi = import_paste.to_int(o)
        old = (existing.get(bid) or {}).get("orders")
        if old is None or oi is None:
            if old is None and oi is not None:
                new += 1
            continue
        if old == oi:
            same += 1
        else:
            differ += 1
            diffs.append((bid, known.get(bid, "")[:18], old, oi))

    print(f"\nmatches counts already on file : {same}")
    print(f"disagrees with them            : {differ}")
    print(f"newly filled                   : {new}")

    if differ:
        print("\n  id      business              was -> now")
        for bid, name, old, oi in sorted(diffs, key=lambda r: -abs(r[3] - r[2]))[:15]:
            print(f"  {bid:<7} {name:<18} {old} -> {oi}")
        # A small drift is possible (orders placed since the last pull); a large
        # one means the pasted block is not a faithful re-measurement.
        allowance = max(3, int(0.05 * (same + differ)))
        if differ > allowance:
            problems.append(
                f"{differ} rows disagree with counts imported from Hive before "
                f"(more than {allowance} allowed) — treat this as a bad copy")

    # --- what the import would actually change ---------------------------
    now_known = sum(1 for m in existing.values() if m.get("orders") is not None)
    print(f"\ncoverage before : {now_known} / {len(biz)}")
    after = {bid for bid, m in existing.items() if m.get("orders") is not None}
    after |= {e[0] for e in entries if e[1] is not None}
    print(f"coverage after  : {len(after)} / {len(biz)}")

    over100 = [import_paste.to_int(e[1]) for e in entries if import_paste.to_int(e[1] or 0) > 100]
    print(f"counts over 100 : {len(over100)}  (max {max(over100) if over100 else 0})")
    if over100 and max(over100) == 500:
        warnings.append("some counts are exactly 500 — the page limit; they may be capped again")

    if warnings:
        print("\nWARN")
        for w in warnings:
            print(f"  - {w}")

    if problems:
        print("\nFAIL")
        for p in problems:
            print(f"  - {p}")
        return 1

    print("\nOK — safe to import")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
