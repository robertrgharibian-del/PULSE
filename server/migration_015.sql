-- PULSE Platform — migration 015 — NAVI: план визита, структурированный ответ ИИ, пост-визитный отчёт по брендам
-- Run in Supabase → SQL Editor (after migration_014.sql)

alter table navi_visits add column if not exists visit_goal text;
alter table navi_visits add column if not exists visit_products jsonb default '[]';       -- pre-visit plan per brand: current/potential/competitors/target
alter table navi_visits add column if not exists ai_sections jsonb;                       -- structured AI response (prior_analysis, technique, timing, etc.)
alter table navi_visits add column if not exists visual_aid_id bigint references product_visual_aids(id);
alter table navi_visits add column if not exists promo_material_id bigint references product_promo_materials(id);
alter table navi_visits add column if not exists post_visit_brands jsonb default '[]';    -- actual monthly Rx per brand, reported after the visit
alter table navi_visits add column if not exists post_visit_agreements jsonb default '[]'; -- agreed weekly Rx per brand, reported after the visit

-- de-duplicate any existing (doctor_id, product_id) rows before adding the uniqueness
-- constraint needed for the post-visit "keep prescriptions current" upsert
delete from navi_doctor_products a using navi_doctor_products b
  where a.doctor_id = b.doctor_id and a.product_id = b.product_id and a.id < b.id;
alter table navi_doctor_products drop constraint if exists navi_doctor_products_unique;
alter table navi_doctor_products add constraint navi_doctor_products_unique unique (doctor_id, product_id);
