-- PULSE Platform — migration 016 — фикс: ai_insights не разрешал scope='bm' и углублённые виды анализа
-- Run in Supabase → SQL Editor (after migration_015.sql)

alter table ai_insights drop constraint if exists ai_insights_scope_check;
alter table ai_insights add constraint ai_insights_scope_check
  check (scope in ('mp', 'rm', 'bm', 'master', 'mp_drilldown', 'rm_drilldown'));
