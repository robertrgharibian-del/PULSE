-- PULSE Platform — migration 020 — добавление новых территорий вручную (сверх встроенного списка)
-- Run in Supabase → SQL Editor (after migration_019.sql)

create table if not exists custom_territories (
  id         bigserial primary key,
  label      text not null unique,
  created_at timestamptz not null default now()
);
