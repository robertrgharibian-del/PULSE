-- PULSE Platform — migration 017 — врачи привязаны к территории, а не к аккаунту МП/РМ
-- Run in Supabase → SQL Editor (after migration_016.sql)

-- ---- NAVI doctors ----
alter table navi_doctors add column if not exists territory text;
update navi_doctors d set territory = u.territory from users u where u.id = d.mp_id and d.territory is null;
alter table navi_doctors alter column mp_id drop not null;
alter table navi_doctors drop constraint if exists navi_doctors_mp_id_fkey;
alter table navi_doctors add constraint navi_doctors_mp_id_fkey foreign key (mp_id) references users(id) on delete set null;
create index if not exists idx_navi_doctors_territory on navi_doctors(territory);

-- ---- DOC TRACKING doctors ----
alter table tracked_doctors add column if not exists territory text;
update tracked_doctors d set territory = u.territory from users u where u.id = d.mp_id and d.territory is null;
alter table tracked_doctors alter column mp_id drop not null;
alter table tracked_doctors drop constraint if exists tracked_doctors_mp_id_fkey;
alter table tracked_doctors add constraint tracked_doctors_mp_id_fkey foreign key (mp_id) references users(id) on delete set null;
create index if not exists idx_tracked_doctors_territory on tracked_doctors(territory);
