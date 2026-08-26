-- ============================================================
-- MANUAL PAYMENT TIME PRECISION — give a manually-entered payment a
-- real timestamp, not just a bare date, so it sorts correctly
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste
-- > Run. Needs 21_admin_payment_management.sql already run (this
-- replaces admin_create_payment()/admin_update_payment() from
-- there).
--
-- Bug this fixes: both functions anchored the admin-chosen date at
-- a fixed noon Asia/Manila, so two manual entries added for the
-- same date landed on the EXACT same timestamp — meaning their
-- relative order against each other (and against real payments from
-- that same day) was a coin flip, not "whichever was actually
-- entered/happened more recently." Anchoring at the CURRENT
-- Manila time-of-day instead of a fixed noon means: entries added
-- today land at (today, right now) — i.e. genuinely now, sorting
-- exactly where they should among everything else happening today —
-- and two backfilled entries for the same past date still land in
-- the order they were actually entered, rather than tied. The date
-- picker still only ever asks for and displays a date — this only
-- changes the hidden time-of-day precision used for sorting.
-- ============================================================

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

  v_at := (p_contributed_on::timestamp + (now() at time zone 'Asia/Manila')::time) at time zone 'Asia/Manila';

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

  v_at := (p_contributed_on::timestamp + (now() at time zone 'Asia/Manila')::time) at time zone 'Asia/Manila';

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
