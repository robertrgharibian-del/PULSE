-- PULSE Platform — migration 021 — автоматическая замена старой загрузки новой + защита от порчи данных при отмене
-- Run in Supabase → SQL Editor (after migration_020.sql)

alter table import_log add column if not exists superseded_by bigint references import_log(id);
