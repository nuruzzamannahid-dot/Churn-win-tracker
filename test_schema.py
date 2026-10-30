#!/usr/bin/env python3
"""Parse the Supabase SQL with the real PostgreSQL grammar.

    python3 test_schema.py

Uses `pglast` (libpg_query), the same parser Postgres itself uses, so a syntax
error is caught here instead of in the SQL editor at 11pm. Skips cleanly when
pglast is not installed:

    python3 -m venv /tmp/pgvenv && /tmp/pgvenv/bin/pip install pglast
    /tmp/pgvenv/bin/python test_schema.py

Also checks the two things that are easy to lose in an edit:
  * both views carry `security_invoker = on`, or anon reads bypass RLS
  * the trigger function pins `search_path`
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
FILES = ["supabase/schema.sql", "supabase/hardening.sql"]

try:
    from pglast import parse_sql
except ImportError:                                     # pragma: no cover
    print("pglast not installed — skipping parse checks")
    print("  python3 -m venv /tmp/pgvenv && /tmp/pgvenv/bin/pip install pglast")
    parse_sql = None

passed = failed = 0


def ok(name: str, cond: bool, extra="") -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name}" + (f"  -> {extra}" if extra else ""))


for rel in FILES:
    path = ROOT / rel
    src = path.read_text(encoding="utf-8")
    print(rel)

    if parse_sql is not None:
        try:
            stmts = parse_sql(src)
            ok(f"parses as PostgreSQL ({len(stmts)} statements)", True)
        except Exception as exc:                        # noqa: BLE001
            ok("parses as PostgreSQL", False, str(exc).splitlines()[0])

    # A comment mentioning service_role is fine; an actual key is not.
    ok("no service_role key committed", not re.search(r"service_role\s*[:=]?\s*['\"]eyJ", src))

    if rel == "supabase/schema.sql":
        views = re.findall(r"create or replace view public\.(v_\w+)\s*\n\s*with \(security_invoker = on\)",
                           src, re.I)
        ok("v_dashboard runs as the caller", "v_dashboard" in views, str(views))
        ok("v_export runs as the caller", "v_export" in views, str(views))
        ok("trigger function pins search_path",
           bool(re.search(r"function public\.log_call_change\(\)[\s\S]{0,200}set search_path", src, re.I)))

        ok("anon may write only the three call columns",
           bool(re.search(r"grant update \(kam, outcome, notes\) on public\.businesses to anon", src, re.I)))
        ok("update grant is not blanket",
           not re.search(r"grant (all|update) on public\.businesses to anon(?![^\n]*\()", src, re.I),
           "a bare GRANT UPDATE would let anon rewrite names and order counts")
        ok("RLS is enabled on both tables",
           src.lower().count("enable row level security") >= 2)
        ok("re-runnable (no bare CREATE TABLE)",
           "create table if not exists" in src.lower())

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
