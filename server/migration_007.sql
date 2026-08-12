-- PULSE Platform — migration 007
-- Run in Supabase → SQL Editor (after migration_006.sql)

-- ---- Groups (product/brand portfolios: Rhythm, Prime, ...) ----
create table if not exists groups (
  id    bigserial primary key,
  name  text unique not null
);
insert into groups (name) values ('Rhythm'), ('Prime') on conflict (name) do nothing;

-- ---- Extend users: BM role + group assignment (for mp and bm roles) ----
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('master','rm','mp','bm'));
alter table users add column if not exists group_id bigint references groups(id);

-- ---- Extend products: group tagging (which portfolio each product belongs to) ----
alter table products add column if not exists group_id bigint references groups(id);

-- Best-effort default classification (Rhythm = cardio, Prime = endocrinology/respiratory).
-- Master can correct these later via the group management UI if guessed wrong.
update products set group_id = (select id from groups where name='Rhythm')
  where name in ('Atorem 10 mg №30','Atorem 20 mg №30','Atorem 40 mg №30','Olmeheart 5 mg №30','Olmeheart 10 mg №30',
                  'Olmeheart 20 mg №30','Olmeheart 40 mg №30','Prasusafe 5 mg №30','Prasusafe 10 mg №30','Plasep 75 mg №30',
                  'RanCV 500 mg №30','RanCV 1000 mg №30','Safetelmi 40 mg №30','Safetelmi 80 mg №30','Rosur 10 mg №30',
                  'Rosur 20 mg №30','Canreal 50 mg/уп');
update products set group_id = (select id from groups where name='Prime')
  where name in ('Pulmofirst 62,5 mg №30','Pulmofirst 125 mg №30','Algic 100 mg №30 (Prime)');

-- ---- MP development plans (RM fills in monthly: KPIs, strengths/weaknesses, results) ----
create table if not exists development_plans (
  id            bigserial primary key,
  mp_id         bigint not null references users(id) on delete cascade,
  rm_id         bigint not null references users(id),
  period_year   int not null,
  period_month  int not null check (period_month between 1 and 12),
  strengths     text,
  weaknesses    text,
  kpis          jsonb not null default '[]',
  achieved_kpis jsonb not null default '[]',
  rm_comment    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (mp_id, period_year, period_month)
);
create index if not exists idx_dev_plans_mp on development_plans(mp_id, period_year, period_month);
