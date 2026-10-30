-- Churn Win Tracker — linter hardening
-- ---------------------------------------------------------------------------
-- Run this once AFTER supabase/schema.sql. It clears the Supabase security
-- advisor findings and is safe to re-run.
--
-- Two of the findings matter:
--
--   1. "Security Definer View" (CRITICAL) on v_dashboard and v_export.
--      Postgres 15+ creates views as SECURITY DEFINER by default, which means
--      the view selects as its owner (postgres) and row level security is
--      evaluated for the owner, not for anon. Today every read policy is
--      `using (true)`, so nothing leaks — but the moment you lock reads down
--      (e.g. switching to Supabase Auth), these views would keep serving every
--      row to anyone holding the anon key. security_invoker makes the view run
--      as the caller, so RLS applies.
--
--   2. "Function Search Path Mutable" on log_call_change().
--      A trigger function without a pinned search_path can be hijacked by a
--      caller-controlled schema. Pinning it costs nothing.
--
-- The other findings are either deliberate or not applicable — see the notes at
-- the bottom.

-- --------------------------------------------------------------------------
-- 1. run the views as the caller, so RLS is enforced
-- --------------------------------------------------------------------------
alter view public.v_dashboard set (security_invoker = on);
alter view public.v_export    set (security_invoker = on);

-- --------------------------------------------------------------------------
-- 2. pin the trigger function's search_path
-- --------------------------------------------------------------------------
create or replace function public.log_call_change() returns trigger
language plpgsql
set search_path = public, pg_temp          -- no implicit lookup outside these
as $$
begin
  if new.outcome is distinct from old.outcome then
    insert into public.call_log (business_id, kam, from_status, to_status)
    values (new.id, new.kam, old.outcome, new.outcome);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- 3. optional: move pg_trgm out of the public schema
-- --------------------------------------------------------------------------
-- The advisor flags extensions installed in `public` because that schema is
-- writable by the API roles. It is low risk here — pg_trgm only provides the
-- gin_trgm_ops operator class used by two indexes — and moving it needs a
-- moment of care, so it is left commented out. Uncomment all three lines
-- together and the existing indexes keep working (they reference the operator
-- class by OID, not by name).
--
-- create schema if not exists extensions;
-- alter extension pg_trgm set schema extensions;
-- set search_path = public, extensions;   -- only affects this session

-- --------------------------------------------------------------------------
-- Expected to remain in the advisor, on purpose
-- --------------------------------------------------------------------------
-- "RLS Policy Always True" on public.businesses
--     This is the design: the dashboard is an internal tool that runs with the
--     public anon key, so the read policy is deliberately unrestricted. What
--     stops abuse is the column-level grant in schema.sql — anon may update
--     kam / outcome / notes and nothing else, so it cannot rewrite a merchant
--     name, phone number or order count.
--
--     If you later want the list to be private, that is the moment to turn on
--     Supabase Auth and change both policies from `to anon, authenticated` to
--     `to authenticated`. The views above will then behave correctly, which is
--     exactly why security_invoker matters.
--
-- "Leaked password protection disabled"
--     Auth is not used by this project yet; it has no effect until you sign in.

-- --------------------------------------------------------------------------
-- verify
-- --------------------------------------------------------------------------
-- Both views should report security_invoker=on:
--
--   select c.relname, coalesce(array_to_string(c.reloptions, ','), '(none)')
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relname in ('v_dashboard', 'v_export');
--
-- The function should report a search_path setting:
--
--   select proname, coalesce(array_to_string(proconfig, ','), '(none)')
--   from pg_proc where proname = 'log_call_change';
