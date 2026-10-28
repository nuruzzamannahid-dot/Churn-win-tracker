#!/usr/bin/env python3
"""Inline src/biz_data.json into src/template.html -> index.html"""
import json, pathlib

root = pathlib.Path(__file__).parent
data = json.loads((root / "src/biz_data.json").read_text(encoding="utf-8"))
raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
tpl = (root / "src/template.html").read_text(encoding="utf-8")
if "__DATA__" not in tpl:
    raise SystemExit("placeholder __DATA__ missing from template")
out = tpl.replace("__DATA__", raw)
(root / "index.html").write_text(out, encoding="utf-8")
print(f"built index.html - {len(data)} rows, {len(out):,} bytes")
