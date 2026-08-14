-- PULSE Platform — migration 013 — NAVI (ИИ-ассистент для визитов)
-- Run in Supabase → SQL Editor (after migration_012.sql)

-- ---- Doctor cards maintained by the MP for NAVI visit assistance ----
create table if not exists navi_doctors (
  id               bigserial primary key,
  mp_id            bigint not null references users(id) on delete cascade,
  last_name        text not null,
  first_name       text,
  patronymic       text,
  city             text,
  lpu              text,
  specialty        text,
  experience_years int,
  psychotype       text,
  visit_minutes    int,
  needs            text,     -- потребности врача
  behavior         text,     -- поведение / особенности на визите
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_navi_doctors_mp on navi_doctors(mp_id);

-- ---- Which portfolio products the doctor already prescribes, and how much ----
create table if not exists navi_doctor_products (
  id              bigserial primary key,
  doctor_id       bigint not null references navi_doctors(id) on delete cascade,
  product_id      bigint not null references products(id),
  prescriptions   int not null default 0    -- примерное кол-во назначений/нед или /мес
);
create index if not exists idx_navi_doctor_products_doctor on navi_doctor_products(doctor_id);

-- ---- Visit log: NAVI's pre-visit recommendation + the MP's post-visit report ----
create table if not exists navi_visits (
  id                bigserial primary key,
  doctor_id         bigint not null references navi_doctors(id) on delete cascade,
  visit_date        date not null default current_date,
  ai_recommendation text,
  ai_lang           text default 'ru',
  mp_report         text,
  created_at        timestamptz not null default now(),
  reported_at       timestamptz
);
create index if not exists idx_navi_visits_doctor on navi_visits(doctor_id, created_at desc);
