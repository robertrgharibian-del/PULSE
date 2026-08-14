-- PULSE Platform — migration 012 — Маркетинговые мероприятия и Активности
-- Run in Supabase → SQL Editor (after migration_011.sql)

-- ---- Types: defined by BM, scoped to a group, with a monthly target count ----
-- category distinguishes "мероприятие" (Rhythm Night, etc.) from "активность" (MSN Gift, etc.)
-- — both follow the same workflow, only the label and a couple of fields differ.
create table if not exists activity_types (
  id              bigserial primary key,
  group_id        bigint not null references groups(id),
  category        text not null check (category in ('event','activity')),
  name            text not null,
  name_uz         text,
  monthly_target  int not null default 0,
  quarterly_target int not null default 0,
  is_active       boolean not null default true,
  created_by      bigint not null references users(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_activity_types_group on activity_types(group_id, category);

-- ---- Entries: MP plans an instance up to 3 months ahead, then fills the actual result ----
create table if not exists activity_entries (
  id                       bigserial primary key,
  activity_type_id         bigint not null references activity_types(id) on delete cascade,
  mp_id                    bigint not null references users(id),
  period_year              int not null,
  period_month             int not null check (period_month between 1 and 12),
  planned_date             date,
  city                     text,
  venue                    text,               -- "место проведения" — used for events
  participants_count       int,
  participant_names        text,               -- "ФИО участников" — used for activities
  comments                 text,
  status                   text not null default 'planned' check (status in ('planned','completed')),
  actual_date              date,
  actual_participants_count int,
  actual_participant_names text,
  actual_comments          text,
  created_at               timestamptz not null default now()
);
create index if not exists idx_activity_entries_mp on activity_entries(mp_id, period_year, period_month);
create index if not exists idx_activity_entries_type on activity_entries(activity_type_id);
