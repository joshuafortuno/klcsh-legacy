-- ============================================================
-- SHOP PAGE — admin-editable descriptions for VIP/MVP/Legacy Pass
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query >
-- paste > Run. Needs 11_shop_core.sql already run.
--
-- STEP 5 of the shop feature (frontend: /shop and /battlepass pages).
--
-- What this adds:
--   Three text columns on site_settings — what each rank/the pass
--   actually gets you in-game. No code here can know that (server
--   perks, permissions, cosmetics — whatever you've actually set
--   up), so this is free text an admin writes and edits from the
--   Manage Contributions page, same pattern as GCash name/number
--   and the shop prices. Already covered by site_settings' existing
--   "viewable by all logged-in users" / "admins can update" RLS —
--   no new policies needed for three more columns on the same row.
-- ============================================================

alter table site_settings add column vip_description text;
alter table site_settings add column mvp_description text;
alter table site_settings add column battlepass_description text;
