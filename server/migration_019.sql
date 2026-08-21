-- PULSE Platform — migration 019 — территории, закреплённые за РМ (можно несколько)
-- Run in Supabase → SQL Editor (after migration_018.sql)

create table if not exists rm_territories (
  id         bigserial primary key,
  rm_id      bigint not null references users(id) on delete cascade,
  territory  text not null,
  created_at timestamptz not null default now(),
  unique (rm_id, territory)
);
create index if not exists idx_rm_territories_rm on rm_territories(rm_id);
