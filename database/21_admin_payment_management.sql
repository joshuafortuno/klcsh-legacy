-- ============================================================
-- ADMIN PAYMENT MANAGEMENT — add/edit/delete a payment_submissions
-- row directly, for members who pay outside the site (cash, bank
-- transfer, GCash sent straight to the admin) and never go through
-- the payment page's submit-and-approve flow
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste
-- > Run. Needs 17_admin_payment_purpose.sql already run (this
-- extends admin_list_payment_submissions() again).
--
-- What this adds:
--   1. gcash_ref_enc/screenshot_url become nullable — a manual
--      entry has neither a real GCash reference nor a screenshot,
--      unlike every payment_submissions row before this. NULL
--      doesn't collide with the gcash_ref_hash uniqueness index
--      from 15_uniqueness_constraints.sql (Postgres treats every
--      NULL as distinct for uniqueness purposes), so any number of
--      manual entries can coexist fine.
--   2. admin_create_payment() — inserts a new row already
--      'approved' (no review needed, the admin IS the reviewer),
--      backdated to whatever date the payment actually happened,
--      anchored at noon Asia/Manila so the displayed date is never
--      off by a day regardless of the server's own timezone — same
--      reasoning as 20_ledger_timezone.sql.
--   3. admin_update_payment() — edits amount/target/rank/battlepass/
--      date on ANY row, including ones a member genuinely submitted
--      and had approved through the normal flow — but never touches
--      gcash_ref_enc/screenshot_url/status, so a real member's proof
--      and its review outcome stay exactly as they were.
--   4. admin_delete_payment() — removes a row outright.
--   5. admin_list_payment_submissions() extended again to also
--      return the raw period_id/side_goal_id (not just their
--      display labels) — the edit form needs the actual id to know
--      which option to preselect.
--   All three admin_* functions below log to status_audit_log, the
--   same accountability trail every other sensitive admin action
--   (approve, reject, clear an expired rank, ...) already gets.
-- ============================================================

alter table payment_submissions alter column gcash_ref_enc drop not null;
alter table payment_submissions alter column screenshot_url drop not null;

create or replace function public.admin_create_payment(
  p_user_id uuid,
  p_amount numeric,
  p_contributed_on date,
  p_period_id uuid default null,
  p_side_goal_id uuid default null,
  p_rank_purchased member_rank default null,
  p_battlepass_purchased boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than 0.';
  end if;

  if p_contributed_on is null then
    raise exception 'Enter the date this payment actually happened.';
  end if;

  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'Member not found.';
  end if;

  if p_period_id is not null and p_side_goal_id is not null then
    raise exception 'Choose at most one of a period or a side goal — not both.';
  end if;

  if p_period_id is null and p_side_goal_id is null
     and p_rank_purchased is null and not p_battlepass_purchased then
    raise exception 'Choose what this payment is for — dues, a side goal, or a shop purchase.';
  end if;

  if p_rank_purchased is not null and p_rank_purchased = 'none' then
    raise exception 'Choose an actual rank, or leave it unselected.';
  end if;

  v_at := (p_contributed_on::timestamp + interval '12 hours') at time zone 'Asia/Manila';

  insert into payment_submissions (
    user_id, period_id, side_goal_id, amount_claimed,
    status, rank_purchased, battlepass_purchased,
    submitted_at, reviewed_at, reviewed_by
  ) values (
    p_user_id, p_period_id, p_side_goal_id, p_amount,
    'approved', p_rank_purchased, p_battlepass_purchased,
    v_at, v_at, auth.uid()
  );

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), p_user_id, 'payment_manually_added', jsonb_build_object(
    'amount', p_amount, 'contributed_on', p_contributed_on,
    'rank_purchased', p_rank_purchased, 'battlepass_purchased', p_battlepass_purchased
  ));
end;
$$;

grant execute on function public.admin_create_payment to authenticated;

create or replace function public.admin_update_payment(
  p_submission_id uuid,
  p_user_id uuid,
  p_amount numeric,
  p_contributed_on date,
  p_period_id uuid default null,
  p_side_goal_id uuid default null,
  p_rank_purchased member_rank default null,
  p_battlepass_purchased boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than 0.';
  end if;

  if p_contributed_on is null then
    raise exception 'Enter the date this payment actually happened.';
  end if;

  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'Member not found.';
  end if;

  if p_period_id is not null and p_side_goal_id is not null then
    raise exception 'Choose at most one of a period or a side goal — not both.';
  end if;

  if p_period_id is null and p_side_goal_id is null
     and p_rank_purchased is null and not p_battlepass_purchased then
    raise exception 'Choose what this payment is for — dues, a side goal, or a shop purchase.';
  end if;

  if p_rank_purchased is not null and p_rank_purchased = 'none' then
    raise exception 'Choose an actual rank, or leave it unselected.';
  end if;

  v_at := (p_contributed_on::timestamp + interval '12 hours') at time zone 'Asia/Manila';

  update payment_submissions
  set user_id = p_user_id,
      period_id = p_period_id,
      side_goal_id = p_side_goal_id,
      amount_claimed = p_amount,
      rank_purchased = p_rank_purchased,
      battlepass_purchased = p_battlepass_purchased,
      submitted_at = v_at,
      reviewed_at = v_at
  where id = p_submission_id;

  if not found then
    raise exception 'Submission not found.';
  end if;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), p_user_id, 'payment_manually_edited', jsonb_build_object(
    'submission_id', p_submission_id, 'amount', p_amount, 'contributed_on', p_contributed_on,
    'rank_purchased', p_rank_purchased, 'battlepass_purchased', p_battlepass_purchased
  ));
end;
$$;

grant execute on function public.admin_update_payment to authenticated;

create or replace function public.admin_delete_payment(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_amount numeric;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  select user_id, amount_claimed into v_user_id, v_amount
  from payment_submissions where id = p_submission_id;

  if v_user_id is null then
    raise exception 'Submission not found.';
  end if;

  delete from payment_submissions where id = p_submission_id;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), v_user_id, 'payment_manually_deleted', jsonb_build_object(
    'submission_id', p_submission_id, 'amount', v_amount
  ));
end;
$$;

grant execute on function public.admin_delete_payment to authenticated;

-- Extend admin_list_payment_submissions() once more — the edit form
-- needs the raw period_id/side_goal_id, not just their display
-- labels, to know which option to preselect. Also guards the GCash
-- ref decrypt against a manual entry's NULL gcash_ref_enc, which
-- pgp_sym_decrypt() would otherwise error on rather than just
-- returning null.
drop function if exists public.admin_list_payment_submissions(payment_status);

create or replace function public.admin_list_payment_submissions(p_status payment_status default null)
returns table (
  id uuid,
  user_id uuid,
  in_game_name text,
  amount_claimed numeric,
  gcash_ref text,
  screenshot_url text,
  status payment_status,
  rejection_reason text,
  submitted_at timestamptz,
  period_id uuid,
  period_month date,
  side_goal_id uuid,
  side_goal_title text,
  rank_purchased member_rank,
  battlepass_purchased boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'profile_encryption_key';

  if v_key is null then
    raise exception 'Encryption key not found in Vault.';
  end if;

  return query
    select
      ps.id, ps.user_id, p.in_game_name, ps.amount_claimed,
      case when ps.gcash_ref_enc is null then null else pgp_sym_decrypt(ps.gcash_ref_enc, v_key) end,
      ps.screenshot_url,
      ps.status, ps.rejection_reason, ps.submitted_at,
      ps.period_id, per.month, ps.side_goal_id, sg.title,
      ps.rank_purchased, ps.battlepass_purchased
    from payment_submissions ps
    join profiles p on p.id = ps.user_id
    left join periods per on per.id = ps.period_id
    left join side_goals sg on sg.id = ps.side_goal_id
    where p_status is null or ps.status = p_status
    order by ps.submitted_at desc;
end;
$$;

grant execute on function public.admin_list_payment_submissions to authenticated;
