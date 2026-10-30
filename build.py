#!/usr/bin/env python3
"""Build index.html from src/template.html + src/db.js.

    python3 build.py

The page no longer carries the 30,507-row dataset. Data lives in Supabase and
the browser asks for one page at a time (see src/db.js and supabase/schema.sql),
so index.html is a small shell instead of a 2.3 MB bundle.

Seed the database with:
    python3 supabase/import.py --push <project-url> <anon-key>
"""
import pathlib
import sys

root = pathlib.Path(__file__).parent

tpl_path = root / "src/template.html"
db_path = root / "src/db.js"

tpl = tpl_path.read_text(encoding="utf-8")
db = db_path.read_text(encoding="utf-8")

if "__DB__" not in tpl:
    sys.exit("placeholder __DB__ missing from src/template.html")

# A literal "</script>" inside the inlined source would end the tag early.
if "</script" in db.lower():
    sys.exit("src/db.js must not contain a closing script tag")

out = tpl.replace("__DB__", db)
(root / "index.html").write_text(out, encoding="utf-8")

print(f"built index.html - {len(out):,} bytes (template {len(tpl):,} + data layer {len(db):,})")
print("data comes from Supabase at runtime; connect it from the header pill")
