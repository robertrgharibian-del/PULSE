-- PULSE Platform — migration 014 — ВОЗМОЖНОСТИ РЫНКА / ОЖИДАНИЯ ПО ПРОДАЖАМ
-- Run in Supabase → SQL Editor (after migration_013.sql)

-- ---- Market opportunities: MP names an opportunity, then fills in a
--      manual packages-impact estimate per product ----
create table if not exists report_opportunities (
  id           bigserial primary key,
  report_id    bigint not null references reports(id) on delete cascade,
  name         text not null,
  created_by   bigint not null references users(id),
  created_at   timestamptz not null default now()
);
create index if not exists idx_opportunities_report on report_opportunities(report_id);

create table if not exists report_opportunity_values (
  id              bigserial primary key,
  opportunity_id  bigint not null references report_opportunities(id) on delete cascade,
  product_id      bigint not null references products(id),
  qty_packages    numeric(10,2) not null default 0,
  unique (opportunity_id, product_id)
);
create index if not exists idx_opportunity_values_opp on report_opportunity_values(opportunity_id);
