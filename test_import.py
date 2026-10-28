#!/usr/bin/env python3
"""Tests for import_paste.py.

    python3 test_import.py

Each case builds a throwaway tree (src/biz_data.json + src/biz_metrics.json),
runs the real script against it, and reads the result back. No real data is
touched.
"""
from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).parent
SCRIPT = HERE / "import_paste.py"

BIZ = [
    [101, "R", "Alpha", "8801111111111"],
    [102, "R", "Beta", "8802222222222"],
    [103, "R", "Gamma", "8803333333333"],
]

passed = failed = 0


def run(metrics: dict, paste: str) -> tuple[dict, str]:
    tmp = pathlib.Path(tempfile.mkdtemp())
    try:
        shutil.copy(SCRIPT, tmp / "import_paste.py")
        (tmp / "src").mkdir()
        (tmp / "src" / "biz_data.json").write_text(json.dumps(BIZ))
        (tmp / "src" / "biz_metrics.json").write_text(json.dumps(metrics))
        (tmp / "pasted.txt").write_text(paste)
        proc = subprocess.run(
            [sys.executable, "import_paste.py", "pasted.txt"],
            cwd=tmp, capture_output=True, text=True, timeout=60,
        )
        out = proc.stdout + proc.stderr
        result = json.loads((tmp / "src" / "biz_metrics.json").read_text())
        return result, out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"ok    {name}")
    else:
        failed += 1
        print(f"FAIL  {name}" + (f"  -> {detail}" if detail else ""))


def wrap(body: str) -> str:
    return f"HIVEPASTE1\n{body}\nHIVEPASTE0\n"


# 1. A blank must never erase an earlier good count. This is the regression that
#    nearly shipped: a 429 during the 191-merchant sweep would have wiped all 349.
m, _ = run({"101": {"orders": 55, "days": 20, "first": "2025-12-30", "last": "2026-07-20"}},
           wrap("101||"))
check("blank keeps an existing count", m["101"]["orders"] == 55, str(m["101"]))
check("blank keeps existing days", m["101"]["days"] == 20, str(m["101"]))
check("blank keeps first/last dates",
      m["101"]["first"] == "2025-12-30" and m["101"]["last"] == "2026-07-20", str(m["101"]))

# 2. New counts replace old ones, including a value that was wrong before.
m, _ = run({"102": {"orders": 100, "days": 0}}, wrap("102|262|45"))
check("new count replaces old", m["102"]["orders"] == 262, str(m["102"]))
check("days updated with count", m["102"]["days"] == 45, str(m["102"]))

# 3. Zero is a real value and must not be confused with a blank.
m, _ = run({}, wrap("103|0|0"))
check("zero orders stored as 0", m["103"]["orders"] == 0, str(m["103"]))
check("zero days stored as 0", m["103"]["days"] == 0, str(m["103"]))

m, _ = run({"103": {"orders": 9, "days": 4}}, wrap("103|0|0"))
check("zero overwrites a stale count", m["103"]["orders"] == 0, str(m["103"]))

# 4. A brand new id with no prior row starts blank-ready.
m, _ = run({}, wrap("101||"))
check("blank on a new id is null", m["101"]["orders"] is None, str(m["101"]))

# 5. Unknown ids are skipped, not invented.
m, _ = run({}, wrap("999|5|1;101|3|1"))
check("unknown id skipped", "999" not in m, str(sorted(m)))
check("known id still imported", m["101"]["orders"] == 3, str(m.get("101")))

# 6. Console noise between the markers must not corrupt parsing.
messy = ("HIVEPASTE1\n--- COPY EVERYTHING BETWEEN THE MARKERS ---\n"
         "101|55|2;102|262|45;103|7|3\n--- end block: 3 merchants ---\nHIVEPASTE0\n")
m, _ = run({}, messy)
check("banner lines ignored", m.get("102", {}).get("orders") == 262, str(m.get("102")))

# 6b. The console wraps long blobs, so a copy can break a token across lines.
wrapped = "HIVEPASTE1\n101|5\n5|2;102|262\n|45\nHIVEPASTE0\n"
m, _ = run({}, wrapped)
check("wrapped token rejoined", m.get("101", {}).get("orders") == 55, str(m.get("101")))
check("wrap before a separator is harmless",
      m.get("102", {}).get("orders") == 262, str(m.get("102")))

# 7. Missing end marker still imports (the console may be truncated).
m, _ = run({}, "HIVEPASTE1\n101|55|2;102|262|45\n")
check("no end marker is fine", m.get("102", {}).get("orders") == 262, str(m.get("102")))

# 8. Sanity warnings fire on impossible data.
_, out = run({}, wrap("101|5|9"))
check("days > orders flagged", "Suspicious rows       : 0" not in out, out)
_, out = run({}, wrap("101|5|2"))
check("clean data not flagged", "Suspicious rows       : 0" in out, out)

# 9. Report distinguishes kept-vs-blank.
_, out = run({"101": {"orders": 55, "days": 2}}, wrap("101||"))
check("kept count reported", "kept an earlier count" in out, out)


# --- 5-field rows from docs/hive-dates.js (id|orders|days|first|last) ---------

m, out = run({}, wrap("101|55|20|2025-03-14|2026-09-02"))
check("5-field row writes orders", m["101"]["orders"] == 55, str(m["101"]))
check("5-field row writes first", m["101"].get("first") == "2025-03-14", str(m["101"]))
check("5-field row writes last", m["101"].get("last") == "2026-09-02", str(m["101"]))
check("dates reported", "Order dates written   : 1" in out, out)

# a later 3-field sweep must not erase dates it does not carry
m, _ = run({"101": {"orders": 55, "days": 20,
                    "first": "2025-03-14", "last": "2026-09-02"}}, wrap("101|55|20"))
check("3-field paste keeps existing dates",
      m["101"].get("first") == "2025-03-14" and m["101"].get("last") == "2026-09-02",
      str(m["101"]))

# a reversed range is unusable and must not be stored
m, _ = run({}, wrap("101|55|20|2026-09-02|2025-03-14"))
check("reversed date range rejected",
      m["101"].get("first") is None and m["101"].get("last") is None, str(m["101"]))
check("reversed range keeps the count", m["101"]["orders"] == 55, str(m["101"]))

# a malformed date must not become a value
m, _ = run({}, wrap("101|55|20|14/03/2025|2026-09-02"))
check("malformed date rejected", m["101"].get("first") is None, str(m["101"]))

# a blank count still leaves earlier dates alone
m, _ = run({"101": {"orders": 55, "days": 20,
                    "first": "2025-01-01", "last": "2025-06-01"}}, wrap("101||||"))
check("blank row keeps dates",
      m["101"].get("first") == "2025-01-01", str(m["101"]))
check("blank row keeps count", m["101"].get("orders") == 55, str(m["101"]))

# dates flow through even when the row also corrects the count
m, _ = run({"101": {"orders": 100, "days": 0}}, wrap("101|262|45|2024-11-02|2026-10-27"))
check("corrected count and dates together",
      m["101"]["orders"] == 262 and m["101"].get("last") == "2026-10-27", str(m["101"]))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
