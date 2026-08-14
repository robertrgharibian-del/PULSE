-- PULSE Platform — migration 011
-- Run in Supabase → SQL Editor (after migration_010.sql)

-- ---- Visual Aid slides: image + detailed talk-track fields ----
create table if not exists product_visual_aids (
  id             bigserial primary key,
  product_id     bigint not null references products(id) on delete cascade,
  image_data     bytea not null,
  image_mime     text not null,
  image_name     text not null,
  content_desc   text,   -- "Содержание слайда"
  purpose        text,   -- "Цель слайда"
  detail_script  text,   -- "Детализация" — talk track for the MP
  comments       text,   -- "Комментарии"
  sort_order     int not null default 0,
  uploaded_by    bigint not null references users(id),
  created_at     timestamptz not null default now()
);
create index if not exists idx_visual_aids_product on product_visual_aids(product_id);

-- ---- Promo materials: image or PDF, with audience targeting + talk track ----
create table if not exists product_promo_materials (
  id                bigserial primary key,
  product_id        bigint not null references products(id) on delete cascade,
  file_data         bytea not null,
  file_mime         text not null,
  file_name         text not null,
  material_name     text not null,
  material_type     text,          -- Лифлет/Блокнот/Кубарик/Буклет/Постер/Бренд ремайндер
  target_audience   text[] default '{}',  -- multi-select specialties
  content_desc      text,
  purpose           text,
  detail_script     text,
  comments          text,
  sort_order        int not null default 0,
  uploaded_by       bigint not null references users(id),
  created_at        timestamptz not null default now()
);
create index if not exists idx_promo_materials_product on product_promo_materials(product_id);

-- ---- Scientific info: articles, studies, presentations, photo/video, any format ----
create table if not exists product_scientific_info (
  id           bigserial primary key,
  product_id   bigint not null references products(id) on delete cascade,
  file_data    bytea not null,
  file_mime    text not null,
  file_name    text not null,
  title        text not null,
  comments     text,
  uploaded_by  bigint not null references users(id),
  created_at   timestamptz not null default now()
);
create index if not exists idx_scientific_info_product on product_scientific_info(product_id);

-- ---- Employee profile photo (shown everywhere the person's name appears) ----
alter table users add column if not exists photo_data bytea;
alter table users add column if not exists photo_mime text;
