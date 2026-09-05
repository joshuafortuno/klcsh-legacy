-- ============================================================
-- NOTIFICATION DELETE — lets a member clear their own notifications
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste
-- > Run. Needs 08_notifications.sql already run.
--
-- notifications previously only granted SELECT + UPDATE(read) to
-- authenticated users — no DELETE policy existed at all, since the
-- table was originally only ever meant to be read and marked read,
-- never edited otherwise. This adds a plain "delete your own rows"
-- policy for the new per-notification × button and "Clear all".
--
-- Safe to allow: nothing regenerates a deleted notification out from
-- under a user. The only recurring generator (see
-- generate_rank_battlepass_notifications() in 12_shop_admin.sql)
-- dedupes by created_at::date = current_date, so deleting today's
-- copy just means it's gone for today — tomorrow's cron run creates
-- a fresh one on its own regardless, not "because" the old one was
-- deleted. Every other notification is a one-time event-triggered
-- insert that never repeats. The actual accountability trail
-- (status_audit_log) is a separate, admin-only table this doesn't
-- touch either way.
-- ============================================================

create policy "users can delete their own notifications"
  on notifications for delete
  to authenticated
  using (auth.uid() = user_id);
