-- ============================================================
-- HARDENING — findings from the full-project audit
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query >
-- paste > Run. Needs 06_payment_submissions.sql, 08_notifications.sql,
-- and 09_public_ledger.sql already run.
--
-- What this adds:
--   1. submit_payment() now checks the target period/side-goal is
--      still open/active before accepting a submission — closes a
--      timing-window bug where a payment made right as an admin
--      finalizes a period could silently attach to a period that
--      will never count it toward anything again.
--   2. generate_period_notifications() gets an explicit REVOKE —
--      every other function in this project has a visible, on-
--      purpose GRANT or REVOKE; this one had neither, so whether a
--      regular member could call it directly (it's meant for
--      pg_cron only) depended on Postgres/Supabase defaults instead
--      of a decision anyone actually made.
--   3. purge_left_members() + a daily pg_cron job — the "15-day
--      countdown to soft-delete" schema.sql's left_at column was
--      built for, but never actually implemented. Anonymizes
--      (doesn't hard-delete) a left member's personal fields once
--      left_at is 15+ days old, so payment_submissions/
--      status_audit_log rows they're linked to stay intact — the
--      ledger's "nothing is edited or removed" promise still holds
--      for the money, only the identity attached to it clears.
--   4. profiles' SELECT grant narrows to exclude real_name_enc and
--      discord_username — every member could previously fetch
--      those two columns for every OTHER member via a direct table
--      query, not just their own. real_name_enc isn't readable
--      without the Vault key regardless, but there's no reason to
--      expose it (or discord_username) more broadly than "yourself,
--      or an admin via the RPCs that already handle decryption."
-- ============================================================

-- ------------------------------------------------------------
-- 1. submit_payment(): validate the target is still open/active
-- ------------------------------------------------------------
create or replace function public.submit_payment(
  p_amount numeric,
  p_gcash_ref text,
  p_screenshot_path text,
  p_period_id uuid default null,
  p_side_goal_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than 0.';
  end if;

  if (p_period_id is null) = (p_side_goal_id is null) then
    raise exception 'Specify exactly one of a period or a side goal.';
  end if;

  if p_period_id is not null and not exists (
    select 1 from periods where id = p_period_id and status = 'open'
  ) then
    raise exception 'This period is no longer open for contributions.';
  end if;

  if p_side_goal_id is not null and not exists (
    select 1 from side_goals where id = p_side_goal_id and status = 'active'
  ) then
    raise exception 'This goal is no longer accepting contributions.';
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'profile_encryption_key';

  if v_key is null then
    raise exception 'Encryption key not found in Vault.';
  end if;

  insert into payment_submissions (
    user_id, period_id, side_goal_id, amount_claimed, gcash_ref_enc, screenshot_url, status
  ) values (
    auth.uid(), p_period_id, p_side_goal_id, p_amount, pgp_sym_encrypt(p_gcash_ref, v_key), p_screenshot_path, 'pending'
  );
end;
$$;

grant execute on function public.submit_payment to authenticated;

-- ------------------------------------------------------------
-- 2. generate_period_notifications(): make cron-only explicit
-- ------------------------------------------------------------
revoke execute on function public.generate_period_notifications() from public;
revoke execute on function public.generate_period_notifications() from authenticated;
revoke execute on function public.generate_period_notifications() from anon;

-- ------------------------------------------------------------
-- 3. 15-day soft-delete for left members
-- ------------------------------------------------------------
create or replace function public.purge_left_members()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
  set in_game_name = 'Former member',
      real_name_enc = null,
      discord_username = null
  where status = 'left'
    and left_at < now() - interval '15 days'
    and in_game_name <> 'Former member'; -- idempotent — skip rows already purged
end;
$$;

-- 2am UTC = 10am Philippine time. Re-running this is safe —
-- cron.schedule() updates the existing job by name instead of
-- erroring if 'purge-left-members' already exists.
select cron.schedule(
  'purge-left-members',
  '0 2 * * *',
  $$select purge_left_members();$$
);

-- ------------------------------------------------------------
-- 4. profiles: narrow the direct-SELECT grant
-- ------------------------------------------------------------
revoke select on profiles from authenticated;
grant select (id, in_game_name, gender, role, status, left_at, created_at) on profiles to authenticated;
