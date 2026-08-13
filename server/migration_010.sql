-- PULSE Platform — migration 010
-- Run in Supabase → SQL Editor (after migration_009.sql)

-- Soft delete: products used in historical reports can't be hard-deleted
-- (foreign keys from report_fss, report_conversion, doctor_weekly_log, etc.)
-- so "deleting" a product from the Portfolio just hides it instead.
alter table products add column if not exists is_active boolean not null default true;
