-- Churn Win Tracker — Supabase schema
-- ---------------------------------------------------------------------------
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
--
-- Design notes
--   * One row per business, with the current call state denormalised onto it
--     (kam / outcome / notes / updated_at). The dashboard never joins, so
--     filtering, sorting and paging are single-table index scans.
--   * The browser never downloads all 30,507 rows. It asks for one page at a
--     time and reads the aggregate panels from v_dashboard in one request.
--   * lifetime_orders is NULL when Hive could not count a merchant. NULL is
--     not zero: the UI renders a dash, and sorting puts NULLs last.
--   * call_log keeps an append-only audit trail so a KAM's action history
--     survives even though only the latest state lives on the row.

create extension if not exists pg_trgm;      -- fast ILIKE '%term%' search

-- --------------------------------------------------------------------------
-- tables
-- --------------------------------------------------------------------------
create table if not exists public.businesses (
  id               text primary key,
  reason           text not null default 'Churn',
  name             text not null,
  phone            text not null default '',
  lifetime_orders  integer,                       -- NULL = not counted (never guessed)
  active_days      integer,                       -- distinct days with an order
  orders_per_month numeric(12, 2),                -- lifetime_orders / months spanned
  is_estimated     boolean not null default false,-- rate derived from active days, not dates
  last_order_date  date,
  hive_churn       boolean not null default true, -- Hive's own 30+ day check
  kam              text not null default 'ahmed'
                     check (kam in ('ahmed', 'nahid')),
  outcome          text not null default 'pending'
                     check (outcome in ('pending', 'no_answer', 'callback', 'won_back',
                                        'activated', 'not_interested', 'wrong_number')),
  notes            text not null default '',
  updated_at       timestamptz not null default now()
);

create table if not exists public.call_log (
  id          bigserial primary key,
  business_id text not null references public.businesses(id) on delete cascade,
  kam         text not null,
  from_status text,
  to_status   text,
  at          timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- indexes — these are what make paging cheap under load
-- --------------------------------------------------------------------------
-- Default view: highest lifetime orders first, NULLs last.
create index if not exists businesses_orders_idx
  on public.businesses (lifetime_orders desc nulls last);

-- Filter combinations used by the toolbar.
create index if not exists businesses_kam_outcome_idx
  on public.businesses (kam, outcome);
create index if not exists businesses_outcome_idx
  on public.businesses (outcome);
create index if not exists businesses_churn_idx
  on public.businesses (hive_churn, lifetime_orders desc nulls last);

-- Substring search over name / phone / id.
create index if not exists businesses_name_trgm_idx
  on public.businesses using gin (name gin_trgm_ops);
create index if not exists businesses_phone_trgm_idx
  on public.businesses using gin (phone gin_trgm_ops);

create index if not exists call_log_business_idx on public.call_log (business_id, at desc);

-- --------------------------------------------------------------------------
-- aggregate view for the KPI cards, KAM board, donut and projection
-- --------------------------------------------------------------------------
create or replace view public.v_dashboard as
select
  (select count(*) from public.businesses)::int                        as total,
  (select count(*) from public.businesses where hive_churn)::int       as churn,
  (select count(*) from public.businesses where not hive_churn)::int   as inactive,
  (select count(*) from public.businesses where outcome <> 'pending')::int as contacted,
  (select count(*) from public.businesses
     where outcome in ('won_back','activated'))::int                   as won,
  (select count(*) from public.businesses where outcome = 'pending')::int as pending,
  (select count(*) from public.businesses where lifetime_orders is not null)::int as metrics_known,
  (select count(*) from public.businesses
     where updated_at::date = current_date and outcome <> 'pending')::int as today_calls,
  (select count(*) from public.businesses
     where updated_at::date = current_date
       and outcome in ('won_back','activated'))::int                   as today_wins,
  coalesce((
    select jsonb_object_agg(outcome, n)
    from (select outcome, count(*)::int as n from public.businesses group by outcome) s
  ), '{}'::jsonb)                                                      as by_status,
  coalesce((
    select jsonb_object_agg(kam, j)
    from (
      select kam, jsonb_build_object(
        'assigned',      count(*),
        'contacted',     count(*) filter (where outcome <> 'pending'),
        'won',           count(*) filter (where outcome in ('won_back','activated')),
        'wonBack',       count(*) filter (where outcome = 'won_back'),
        'activated',     count(*) filter (where outcome = 'activated'),
        'notInterested', count(*) filter (where outcome = 'not_interested'),
        'noAnswer',      count(*) filter (where outcome = 'no_answer'),
        'callback',      count(*) filter (where outcome = 'callback'),
        'pending',       count(*) filter (where outcome = 'pending'),
        'churnTotal',    count(*) filter (where hive_churn),
        'churnWon',      count(*) filter (where hive_churn
                            and outcome in ('won_back','activated')),
        'inactiveTotal', count(*) filter (where not hive_churn),
        'inactiveWon',   count(*) filter (where not hive_churn
                            and outcome in ('won_back','activated'))
      ) as j
      from public.businesses group by kam
    ) s2
  ), '{}'::jsonb)                                                      as by_kam,
  (select jsonb_build_object(
      'called',   count(*) filter (where outcome <> 'pending'),
      'won',      count(*) filter (where outcome in ('won_back','activated'))
   ) from public.businesses where hive_churn)                          as churn_progress,
  (select jsonb_build_object(
      'called',   count(*) filter (where outcome <> 'pending'),
      'won',      count(*) filter (where outcome in ('won_back','activated'))
   ) from public.businesses where not hive_churn)                      as inactive_progress,
  coalesce((
    select jsonb_build_object(
      'total',    coalesce(sum(orders_per_month), 0),
      'won',      coalesce(sum(orders_per_month) filter (
                    where outcome in ('won_back','activated')), 0),
      'lost',     coalesce(sum(orders_per_month) filter (
                    where outcome in ('not_interested','wrong_number')), 0),
      'open',     coalesce(sum(orders_per_month) filter (
                    where outcome not in ('won_back','activated','not_interested','wrong_number')), 0),
      'n',        count(*),
      'est',      count(*) filter (where is_estimated),
      -- the same sums with estimated rates removed, so the panel's
      -- "include estimated merchants" toggle is a pure client-side choice
      'total_measured',    coalesce(sum(orders_per_month) filter (where not is_estimated), 0),
      'won_measured',      coalesce(sum(orders_per_month) filter (
                             where not is_estimated
                               and outcome in ('won_back','activated')), 0),
      'lost_measured',     coalesce(sum(orders_per_month) filter (
                             where not is_estimated
                               and outcome in ('not_interested','wrong_number')), 0),
      'open_measured',     coalesce(sum(orders_per_month) filter (
                             where not is_estimated
                               and outcome not in ('won_back','activated','not_interested','wrong_number')), 0),
      'n_measured',        count(*) filter (where not is_estimated),
      'excluded', (select count(*) from public.businesses
                    where lifetime_orders is not null and orders_per_month is null)
    )
    from public.businesses where orders_per_month is not null
  ), '{}'::jsonb)                                                      as projection;

grant select on public.v_dashboard to anon, authenticated;

-- --------------------------------------------------------------------------
-- keep the audit trail
-- --------------------------------------------------------------------------
create or replace function public.log_call_change() returns trigger
language plpgsql as $$
begin
  if new.outcome is distinct from old.outcome then
    insert into public.call_log (business_id, kam, from_status, to_status)
    values (new.id, new.kam, old.outcome, new.outcome);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists businesses_log_call on public.businesses;
create trigger businesses_log_call
  before update on public.businesses
  for each row execute function public.log_call_change();

-- --------------------------------------------------------------------------
-- row level security
-- --------------------------------------------------------------------------
-- The dashboard is an internal tool that runs with the public anon key, so
-- anon gets read access to businesses and write access to the four call
-- columns only — it must never be able to rewrite task data.
--
-- Read this before going live: anyone with the anon key can read every phone
-- number and record calls. If that is not acceptable, turn on Supabase Auth
-- and replace the policies below with `to authenticated` ones.
alter table public.businesses enable row level security;
alter table public.call_log enable row level security;

drop policy if exists businesses_read on public.businesses;
create policy businesses_read on public.businesses
  for select to anon, authenticated using (true);

drop policy if exists businesses_write on public.businesses;
create policy businesses_write on public.businesses
  for update to anon, authenticated using (true) with check (true);

drop policy if exists call_log_read on public.call_log;
create policy call_log_read on public.call_log
  for select to anon, authenticated using (true);

-- Column level guard: anon may update the call columns, and nothing else.
revoke update on public.businesses from anon, authenticated;
grant update (kam, outcome, notes) on public.businesses to anon, authenticated;
grant select on public.businesses to anon, authenticated;

-- --------------------------------------------------------------------------
-- optional: analytics helper for the sheet-style export
-- --------------------------------------------------------------------------
create or replace view public.v_export as
select id, reason, name, phone, lifetime_orders, active_days,
       case when active_days is null or active_days = 0 or lifetime_orders is null
            then null
            else round(lifetime_orders::numeric / active_days, 2)
       end as avg_per_day,
       kam, outcome, notes, updated_at, hive_churn
from public.businesses;
grant select on public.v_export to anon, authenticated;
