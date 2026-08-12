-- PULSE Platform — migration 008 — DOC TRACKING
-- Run in Supabase → SQL Editor (after migration_007.sql)

-- ---- Doctors tracked post-conference (owned by the MP who added them) ----
create table if not exists tracked_doctors (
  id             bigserial primary key,
  mp_id          bigint not null references users(id) on delete cascade,
  full_name      text not null,
  specialty      text,                 -- e.g. Кардиолог / Интервенционист
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

-- ---- 10 indicator pharmacies per doctor ----
create table if not exists doctor_pharmacies (
  id          bigserial primary key,
  doctor_id   bigint not null references tracked_doctors(id) on delete cascade,
  name        text not null,
  address     text,
  sort_order  int not null default 0
);
create index if not exists idx_doctor_pharmacies_doctor on doctor_pharmacies(doctor_id);

-- ---- Weekly Rx/sales log per doctor (price is looked up live from products.nrv_usd) ----
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
