-- FSS Review Platform — schema for Supabase (Postgres)
-- Run this once in Supabase → SQL Editor → New query → Run

-- ============================================================
-- USERS (master / rm / mp)
-- ============================================================
create table if not exists users (
  id            bigserial primary key,
  email         text unique not null,
  password_hash text not null,
  full_name     text not null,
  role          text not null check (role in ('master','rm','mp')),
  rm_id         bigint references users(id) on delete set null, -- set only for role='mp': which RM they report to
  territory     text,          -- free text, e.g. "Самаркандская область"
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ============================================================
-- PRODUCT CATALOG (shared, FY'27 MSN Rhythm + Prime portfolio)
-- ============================================================
create table if not exists products (
  id       bigserial primary key,
  name     text not null,
  nrv_usd  numeric(10,2) not null default 0,
  sort_order int not null default 0
);

-- ============================================================
-- REPORTS — one per MP per month
-- ============================================================
create table if not exists reports (
  id               bigserial primary key,
  mp_id            bigint not null references users(id) on delete cascade,
  period_year      int not null,
  period_month     int not null check (period_month between 1 and 12),
  status           text not null default 'draft'
                     check (status in ('draft','submitted','returned','approved')),
  base_rate_uzs    numeric(14,2) not null default 15000000,
  fx_rate          numeric(10,2) not null default 13000,
  submitted_at     timestamptz,
  rm_reviewed_at   timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (mp_id, period_year, period_month)
);

-- ---- FSS: target/actual per product ----
create table if not exists report_fss (
  id          bigserial primary key,
  report_id   bigint not null references reports(id) on delete cascade,
  product_id  bigint not null references products(id),
  target_qty  numeric(12,2) not null default 0,
  actual_qty  numeric(12,2) not null default 0,
  unique (report_id, product_id)
);

-- ---- FFE: field force effectiveness metrics (gate at 85%) ----
create table if not exists report_ffe (
  id              bigserial primary key,
  report_id       bigint not null references reports(id) on delete cascade,
  metric_key      text not null check (metric_key in (
                      'doctor_coverage_a','doctor_coverage_b',
                      'core_doctor_coverage_a','core_doctor_coverage_b',
                      'doctor_call_coverage_a','doctor_call_coverage_b',
                      'core_call_coverage_a','core_call_coverage_b',
                      'pharmacy_coverage_a','pharmacy_coverage_b')),
  master_list_count int not null default 0,   -- doctors/pharmacies in master list
  approved_count     int not null default 0,  -- approved subset (e.g. core doctors)
  achieved_count     int not null default 0,  -- actually covered/called
  unique (report_id, metric_key)
);

-- ---- field days breakdown (feeds FFE context) ----
create table if not exists report_field_days (
  report_id        bigint primary key references reports(id) on delete cascade,
  total_days       int not null default 30,
  non_working_days int not null default 0,
  public_holidays  int not null default 0,
  training_days    int not null default 0,
  leave_days       int not null default 0,
  field_days       int not null default 0
);

-- ---- Action plan ----
create table if not exists report_action_plan (
  id             bigserial primary key,
  report_id      bigint not null references reports(id) on delete cascade,
  product_name   text not null,
  goal           text,
  action_text    text,
  control_date   date,
  completion_date date,
  sort_order     int not null default 0
);

-- ---- Comments (per line item, left by RM or Master during review) ----
create table if not exists report_comments (
  id          bigserial primary key,
  report_id   bigint not null references reports(id) on delete cascade,
  section     text not null check (section in ('fss','ffe','action_plan','general')),
  item_ref    bigint,              -- id of report_fss / report_ffe / report_action_plan row (null for 'general')
  author_id   bigint not null references users(id),
  author_role text not null,
  comment_text text not null,
  created_at  timestamptz not null default now()
);

-- ---- Status change history / audit trail ----
create table if not exists report_status_log (
  id          bigserial primary key,
  report_id   bigint not null references reports(id) on delete cascade,
  from_status text,
  to_status   text not null,
  actor_id    bigint not null references users(id),
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_reports_mp on reports(mp_id);
create index if not exists idx_users_rm on users(rm_id);
create index if not exists idx_fss_report on report_fss(report_id);
create index if not exists idx_ffe_report on report_ffe(report_id);
create index if not exists idx_comments_report on report_comments(report_id);

-- migration 002 (kept in sync here for fresh installs — see migration_002.sql for existing DBs)
alter table reports add column if not exists non_reimbursement_ok boolean not null default true;
create index if not exists idx_reports_period on reports(period_year, period_month);

-- migration 003 (kept in sync here for fresh installs — see migration_003.sql for existing DBs)
create table if not exists report_conversion (
  id                      bigserial primary key,
  report_id               bigint not null references reports(id) on delete cascade,
  product_id              bigint not null references products(id),
  doctor_name             text not null,
  current_rx_per_week     numeric(10,2) not null default 0,
  competitor_rx_per_week  numeric(10,2) not null default 0,
  competitor_reason       text,
  mp_action_plan          text,
  target_rx_per_week      numeric(10,2) not null default 0,
  start_date              date,
  control_date            date,
  created_at              timestamptz not null default now()
);
create table if not exists report_potential (
  id                        bigserial primary key,
  report_id                 bigint not null references reports(id) on delete cascade,
  product_id                bigint not null references products(id),
  doctor_name               text not null,
  current_potential_per_week numeric(10,2) not null default 0,
  reason_not_treating       text,
  mp_action_plan            text,
  target_rx_per_week        numeric(10,2) not null default 0,
  start_date                date,
  control_date              date,
  created_at                timestamptz not null default now()
);
create table if not exists reminder_log (
  id           bigserial primary key,
  entity_type  text not null check (entity_type in ('conversion','potential')),
  entity_id    bigint not null,
  sent_at      timestamptz not null default now()
);
create index if not exists idx_reminder_entity on reminder_log(entity_type, entity_id, sent_at desc);
create index if not exists idx_conversion_report on report_conversion(report_id);
create index if not exists idx_potential_report on report_potential(report_id);
create table if not exists import_log (
  id           bigserial primary key,
  import_type  text not null check (import_type in ('fss','targets')),
  period_year  int not null,
  period_month int,
  uploaded_by  bigint not null references users(id),
  summary      jsonb,
  created_at   timestamptz not null default now()
);

-- migration 004 (kept in sync here for fresh installs — see migration_004.sql for existing DBs)
alter table report_conversion add column if not exists doctor_specialty text;
alter table report_conversion add column if not exists lpu_name text;
alter table report_potential add column if not exists doctor_specialty text;
alter table report_potential add column if not exists lpu_name text;
alter table reports add column if not exists underperformance_note text;

-- migration 005 (kept in sync here for fresh installs — see migration_005.sql for existing DBs)
create table if not exists ai_insights (
  id          bigserial primary key,
  scope       text not null check (scope in ('mp','rm','master')),
  scope_id    bigint,
  content     jsonb not null,
  model       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ai_insights_scope on ai_insights(scope, scope_id, created_at desc);

-- migration 006 (kept in sync here for fresh installs — see migration_006.sql for existing DBs)
create table if not exists password_reset_requests (
  id           bigserial primary key,
  user_id      bigint not null references users(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','resolved')),
  requested_at timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists idx_pw_reset_status on password_reset_requests(status);
alter table import_log add column if not exists changes jsonb;
alter table import_log add column if not exists reverted boolean not null default false;
alter table report_conversion add column if not exists previous_target_rx_per_week numeric(10,2);
alter table report_conversion add column if not exists actual_result_rx_per_week numeric(10,2);
alter table report_potential add column if not exists previous_target_rx_per_week numeric(10,2);
alter table report_potential add column if not exists actual_result_rx_per_week numeric(10,2);

-- migration 007 (kept in sync here for fresh installs — see migration_007.sql for existing DBs)
create table if not exists groups (
  id    bigserial primary key,
  name  text unique not null
);
insert into groups (name) values ('Rhythm'), ('Prime') on conflict (name) do nothing;
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('master','rm','mp','bm'));
alter table users add column if not exists group_id bigint references groups(id);
alter table products add column if not exists group_id bigint references groups(id);
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

-- migration 008 (kept in sync here for fresh installs — see migration_008.sql for existing DBs) — DOC TRACKING
create table if not exists tracked_doctors (
  id             bigserial primary key,
  mp_id          bigint not null references users(id) on delete cascade,
  full_name      text not null,
  specialty      text,
  city           text,
  clinic         text,
  contact        text,
  trip_start     date,
  trip_end       date,
  event_name     text,
  event_city     text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_tracked_doctors_mp on tracked_doctors(mp_id);
create table if not exists doctor_pharmacies (
  id          bigserial primary key,
  doctor_id   bigint not null references tracked_doctors(id) on delete cascade,
  name        text not null,
  address     text,
  sort_order  int not null default 0
);
create index if not exists idx_doctor_pharmacies_doctor on doctor_pharmacies(doctor_id);
create table if not exists doctor_weekly_log (
  id            bigserial primary key,
  doctor_id     bigint not null references tracked_doctors(id) on delete cascade,
  log_date      date not null,
  pharmacy_id   bigint references doctor_pharmacies(id),
  product_id    bigint not null references products(id),
  qty_packages  numeric(10,2) not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_doctor_log_doctor on doctor_weekly_log(doctor_id, log_date);

-- migration 009 (kept in sync here for fresh installs — see migration_009.sql for existing DBs) — PORTFOLIO
alter table products add column if not exists key_messages text;
alter table products add column if not exists positioning text;
alter table products add column if not exists patient_portraits text;
alter table products add column if not exists updated_at timestamptz not null default now();
create table if not exists product_files (
  id           bigserial primary key,
  product_id   bigint not null references products(id) on delete cascade,
  file_type    text not null check (file_type in ('pil','slides','other')),
  file_name    text not null,
  mime_type    text not null,
  file_data    bytea not null,
  uploaded_by  bigint not null references users(id),
  created_at   timestamptz not null default now()
);
create index if not exists idx_product_files_product on product_files(product_id);
create table if not exists product_competitors (
  id                 bigserial primary key,
  product_id         bigint not null references products(id) on delete cascade,
  competitor_name    text not null,
  is_direct          boolean not null default true,
  competitor_price_usd numeric(10,2),
  price_updated_at   timestamptz,
  price_updated_by   bigint references users(id),
  created_at         timestamptz not null default now()
);
create index if not exists idx_product_competitors_product on product_competitors(product_id);

-- ============================================================
-- SEED: product catalog (FY'27, MSN Rhythm + Prime)
-- ============================================================
insert into products (name, nrv_usd, sort_order) values
  ('Atorem 10 mg №30', 1.63, 1),
  ('Atorem 20 mg №30', 3.25, 2),
  ('Atorem 40 mg №30', 5.00, 3),
  ('Olmeheart 5 mg №30', 2.00, 4),
  ('Olmeheart 10 mg №30', 2.20, 5),
  ('Olmeheart 20 mg №30', 2.86, 6),
  ('Olmeheart 40 mg №30', 4.00, 7),
  ('Prasusafe 5 mg №30', 6.00, 8),
  ('Prasusafe 10 mg №30', 8.00, 9),
  ('Plasep 75 mg №30', 2.18, 10),
  ('RanCV 500 mg №30', 8.00, 11),
  ('RanCV 1000 mg №30', 10.00, 12),
  ('Safetelmi 40 mg №30', 2.22, 13),
  ('Safetelmi 80 mg №30', 3.75, 14),
  ('Rosur 10 mg №30', 3.75, 15),
  ('Rosur 20 mg №30', 6.00, 16),
  ('Pulmofirst 62,5 mg №30', 37.32, 17),
  ('Pulmofirst 125 mg №30', 50.00, 18),
  ('Canreal 50 mg/уп', 200.00, 19),
  ('Algic 100 mg №30 (Prime)', 2.50, 20)
on conflict do nothing;

-- Best-effort default group classification (Rhythm = cardio, Prime = endocrinology/respiratory).
-- Master can correct these later via the group management UI if guessed wrong.
update products set group_id = (select id from groups where name='Rhythm')
  where name in ('Atorem 10 mg №30','Atorem 20 mg №30','Atorem 40 mg №30','Olmeheart 5 mg №30','Olmeheart 10 mg №30',
                  'Olmeheart 20 mg №30','Olmeheart 40 mg №30','Prasusafe 5 mg №30','Prasusafe 10 mg №30','Plasep 75 mg №30',
                  'RanCV 500 mg №30','RanCV 1000 mg №30','Safetelmi 40 mg №30','Safetelmi 80 mg №30','Rosur 10 mg №30',
                  'Rosur 20 mg №30','Canreal 50 mg/уп');
update products set group_id = (select id from groups where name='Prime')
  where name in ('Pulmofirst 62,5 mg №30','Pulmofirst 125 mg №30','Algic 100 mg №30 (Prime)');

-- ============================================================
-- SEED: master account (CHANGE THE PASSWORD HASH BEFORE GOING LIVE!)
-- Default login: admin@fss.local / password: ChangeMe123!
-- Hash below corresponds to "ChangeMe123!" — see README for how to
-- generate your own hash and update this row.
-- ============================================================
insert into users (email, password_hash, full_name, role)
values ('admin@fss.local', '$2b$10$0ec5JdSYxe3dQ1OCFAcMeu8axRzyiHzxbHU7B2uT3G7fvtr7U4wAG', 'Master Admin', 'master')
on conflict (email) do nothing;
