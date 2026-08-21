-- PULSE Platform — migration 018 — Бренды (группировка SKU), удаление команд, архив пользователей
-- Run in Supabase → SQL Editor (after migration_017.sql)

-- ---- Brands: group several SKUs together, linked to a team (Rhythm/Prime/...) ----
create table if not exists brands (
  id         bigserial primary key,
  name       text not null,
  group_id   bigint references groups(id) on delete set null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_brands_group on brands(group_id);

alter table products add column if not exists brand_id bigint references brands(id) on delete set null;
create index if not exists idx_products_brand on products(brand_id);

-- ---- Teams (groups) can be soft-deleted (retired) rather than only ever added ----
alter table groups add column if not exists is_active boolean not null default true;
