-- PULSE Platform — migration 009 — PORTFOLIO
-- Run in Supabase → SQL Editor (after migration_008.sql)

-- ---- Extend products with portfolio content fields ----
alter table products add column if not exists key_messages text;
alter table products add column if not exists positioning text;
alter table products add column if not exists patient_portraits text;
alter table products add column if not exists updated_at timestamptz not null default now();

-- ---- Files per product: PIL, visual aid slides, or other material ----
-- Stored directly in Postgres (bytea) — simplest reliable option without
-- a separate file-storage service; fine at this scale (a few files per SKU).
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

-- ---- Direct/indirect competitors + manually-observed pharmacy prices ----
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
