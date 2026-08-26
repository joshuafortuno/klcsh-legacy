-- ============================================================
-- PAYMENT TARGET OPTIONAL — relax the table-level constraint to
-- match submit_payment()'s updated rule
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste
-- > Run. Needs 16_shop_only_payments.sql already run.
--
-- Bug this fixes: 04_admin_dashboard.sql added a CHECK constraint,
-- payment_targets_one_thing, requiring EXACTLY one of period_id/
-- side_goal_id to be set — back when every payment was a dues or
-- side-goal contribution. 16_shop_only_payments.sql updated
-- submit_payment()'s own validation to allow a pure shop purchase
-- (both null), but never touched this constraint, which lives on
-- the table itself and isn't affected by replacing the function —
-- so a shop-only submission still got rejected at insert time with
-- "violates check constraint payment_targets_one_thing", the
-- function's own friendlier error message never even being reached.
-- ============================================================

alter table payment_submissions drop constraint payment_targets_one_thing;

alter table payment_submissions
  add constraint payment_targets_at_most_one check (
    period_id is null or side_goal_id is null
  );
