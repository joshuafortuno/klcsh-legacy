-- ============================================================
-- ADMIN DASHBOARD — schema + admin-only functions
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query >
-- paste > Run. Needs schema.sql, 02_profile_creation.sql, and
-- 03_profile_management.sql already run.
--
-- What this adds:
--   1. is_admin() — the missing piece schema.sql's comments
--      flagged: a safe way for RLS/functions to check "is the
--      calling user an admin". Everything else in this file
--      depends on it.
--   2. periods.title — the name you type for a month's goal.
--   3. side_goals — smaller, optional goals (anti-cheat license,
--      event prizes) that sit outside the mandatory monthly
--      split.
--   4. payment_submissions can now point at EITHER a period
--      (regular monthly dues) OR a side_goal (voluntary chip-in)
--      — same submit-proof-and-approve flow serves both.
--   5. Admin RPC functions for everything the dashboard needs:
--      listing profiles/payments with decryption, approving or
--      rejecting payments, approving/denying leave requests
--      (which also updates member status), editing a member's
--      role/status, and finalizing a period (locks expenses,
--      computes the per-member split, carries surplus into a
--      newly-opened next period).
--   6. Admin RLS write policies for periods/expenses/side_goals
--      — these aren't encrypted, so plain RLS is enough (no RPC
--      needed, unlike the functions above).
-- ============================================================

-- ------------------------------------------------------------
-- IS_ADMIN()
-- security definer so the internal profiles lookup bypasses
-- RLS — otherwise checking "is this user an admin" from inside
-- a profiles RLS policy could recurse into itself.
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_admin to authenticated;

-- ------------------------------------------------------------
-- PERIODS: add a title
-- ------------------------------------------------------------
alter table periods add column if not exists title text;

-- ------------------------------------------------------------
-- SIDE GOALS
-- Optional, voluntary goals outside the regular monthly split.
-- No "current amount" column on purpose — that's always summed
-- live from approved payment_submissions (see side_goal_progress
-- below), so it can never drift out of sync.
-- ------------------------------------------------------------
create type side_goal_status as enum ('active', 'completed');

create table side_goals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  target numeric(10, 2) not null check (target > 0),
  status side_goal_status not null default 'active',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table side_goals enable row level security;

create policy "side goals are viewable by all logged-in users"
  on side_goals for select
  to authenticated
  using (true);

create policy "admins can insert side goals"
  on side_goals for insert
  to authenticated
  with check (is_admin());

create policy "admins can update side goals"
  on side_goals for update
  to authenticated
  using (is_admin());

-- ------------------------------------------------------------
-- PAYMENT_SUBMISSIONS: allow targeting a side_goal instead of
-- a period. Exactly one of the two must be set.
-- ------------------------------------------------------------
alter table payment_submissions alter column period_id drop not null;

alter table payment_submissions
  add column side_goal_id uuid references side_goals(id) on delete cascade;

alter table payment_submissions
  add constraint payment_targets_one_thing check (
    (period_id is not null and side_goal_id is null) or
    (period_id is null and side_goal_id is not null)
  );

-- ------------------------------------------------------------
-- PUBLIC AGGREGATE PROGRESS
-- These return only a SUM, never individual rows — safe to let
-- any logged-in member call directly (needed for progress bars
-- on the homepage), even though the underlying payment rows are
-- otherwise only visible to their owner or an admin.
-- ------------------------------------------------------------
create or replace function public.side_goal_progress(p_side_goal_id uuid)
returns numeric
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(sum(amount_claimed), 0)
  from payment_submissions
  where side_goal_id = p_side_goal_id and status = 'approved';
$$;

grant execute on function public.side_goal_progress to authenticated;

create or replace function public.period_progress(p_period_id uuid)
returns numeric
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(sum(amount_claimed), 0)
  from payment_submissions
  where period_id = p_period_id and status = 'approved';
$$;

grant execute on function public.period_progress to authenticated;

-- ============================================================
-- ADMIN RPC FUNCTIONS
-- Every one of these starts with an is_admin() check and raises
-- an exception otherwise — they're granted to `authenticated`
-- (any logged-in user can CALL them), but only an admin gets
-- past the first line.
-- ============================================================

-- --- Manage Accounts -----------------------------------------

create or replace function public.admin_list_profiles()
returns table (
  id uuid,
  in_game_name text,
  real_name text,
  discord_username text,
  gender member_gender,
  role member_role,
  status member_status,
  left_at timestamptz,
  created_at timestamptz
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
      p.id, p.in_game_name, pgp_sym_decrypt(p.real_name_enc, v_key),
      p.discord_username, p.gender, p.role, p.status, p.left_at, p.created_at
    from profiles p
    order by p.in_game_name;
end;
$$;

grant execute on function public.admin_list_profiles to authenticated;

create or replace function public.admin_set_role(p_user_id uuid, p_role member_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old member_role;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  select role into v_old from profiles where id = p_user_id;
  if v_old is null then
    raise exception 'Member not found.';
  end if;

  update profiles set role = p_role where id = p_user_id;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), p_user_id, 'role_change', jsonb_build_object('from', v_old, 'to', p_role));
end;
$$;

grant execute on function public.admin_set_role to authenticated;

create or replace function public.admin_set_status(p_user_id uuid, p_status member_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old member_status;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  select status into v_old from profiles where id = p_user_id;
  if v_old is null then
    raise exception 'Member not found.';
  end if;

  update profiles
  set status = p_status,
      left_at = case when p_status = 'left' then now() else null end
  where id = p_user_id;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), p_user_id, 'status_change', jsonb_build_object('from', v_old, 'to', p_status));
end;
$$;

grant execute on function public.admin_set_status to authenticated;

-- --- Notifications: leave requests -----------------------------

create or replace function public.admin_list_leave_requests(p_status leave_request_status default 'pending')
returns table (
  id uuid,
  user_id uuid,
  in_game_name text,
  status leave_request_status,
  requested_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  return query
    select lr.id, lr.user_id, p.in_game_name, lr.status, lr.requested_at
    from leave_requests lr
    join profiles p on p.id = lr.user_id
    where p_status is null or lr.status = p_status
    order by lr.requested_at desc;
end;
$$;

grant execute on function public.admin_list_leave_requests to authenticated;

-- Approves the request AND moves the member to 'left' in one
-- step (starts the 15-day soft-delete countdown), both logged.
create or replace function public.admin_approve_leave_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_old_status member_status;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  select user_id into v_user_id from leave_requests where id = p_request_id and status = 'pending';
  if v_user_id is null then
    raise exception 'Leave request not found or already reviewed.';
  end if;

  select status into v_old_status from profiles where id = v_user_id;

  update leave_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id;

  update profiles
  set status = 'left', left_at = now()
  where id = v_user_id;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (
    auth.uid(), v_user_id, 'status_change',
    jsonb_build_object('from', v_old_status, 'to', 'left', 'reason', 'leave_request_approved')
  );
end;
$$;

grant execute on function public.admin_approve_leave_request to authenticated;

create or replace function public.admin_deny_leave_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  update leave_requests
  set status = 'denied', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id and status = 'pending';

  if not found then
    raise exception 'Leave request not found or already reviewed.';
  end if;
end;
$$;

grant execute on function public.admin_deny_leave_request to authenticated;

-- --- Notifications & Contributions: payment submissions --------

-- p_status = null returns every submission (used by the
-- Contributions page); a specific status narrows it (Notifications
-- uses 'pending'). Decrypts the GCash reference for admin review.
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
  period_month date,
  side_goal_title text
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
      pgp_sym_decrypt(ps.gcash_ref_enc, v_key), ps.screenshot_url,
      ps.status, ps.rejection_reason, ps.submitted_at,
      per.month, sg.title
    from payment_submissions ps
    join profiles p on p.id = ps.user_id
    left join periods per on per.id = ps.period_id
    left join side_goals sg on sg.id = ps.side_goal_id
    where p_status is null or ps.status = p_status
    order by ps.submitted_at desc;
end;
$$;

grant execute on function public.admin_list_payment_submissions to authenticated;

create or replace function public.admin_approve_payment(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  update payment_submissions
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_submission_id and status = 'pending'
  returning user_id into v_user_id;

  if v_user_id is null then
    raise exception 'Payment submission not found or already reviewed.';
  end if;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), v_user_id, 'payment_approved', jsonb_build_object('submission_id', p_submission_id));
end;
$$;

grant execute on function public.admin_approve_payment to authenticated;

create or replace function public.admin_reject_payment(p_submission_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  update payment_submissions
  set status = 'rejected', rejection_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_submission_id and status = 'pending'
  returning user_id into v_user_id;

  if v_user_id is null then
    raise exception 'Payment submission not found or already reviewed.';
  end if;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), v_user_id, 'payment_rejected', jsonb_build_object('submission_id', p_submission_id, 'reason', p_reason));
end;
$$;

grant execute on function public.admin_reject_payment to authenticated;

-- --- Dashboard: cheap counts, no decryption -------------------
-- Just numbers for badges — avoids running the decrypting list
-- function above just to show "3 pending".
create or replace function public.admin_pending_counts()
returns table (pending_payments int, pending_leave_requests int)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  return query
    select
      (select count(*)::int from payment_submissions where status = 'pending'),
      (select count(*)::int from leave_requests where status = 'pending');
end;
$$;

grant execute on function public.admin_pending_counts to authenticated;

-- --- Manage Contributions: periods & finalization ---------------

-- Always returns a usable open period for the admin to add
-- expenses against — creates this calendar month's if none
-- exists yet. Bootstraps the very first period on a fresh site.
create or replace function public.admin_get_or_create_open_period()
returns periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period periods;
  v_this_month date;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  select * into v_period from periods where status = 'open' order by month desc limit 1;
  if found then
    return v_period;
  end if;

  v_this_month := date_trunc('month', now())::date;

  insert into periods (month, status)
  values (v_this_month, 'open')
  returning * into v_period;

  return v_period;
end;
$$;

grant execute on function public.admin_get_or_create_open_period to authenticated;

-- Locks the period's expenses, computes the per-member split,
-- works out the surplus/deficit (approved payments collected
-- minus total expenses), and opens next month's period with
-- that surplus carried in.
--
-- Safe to call again on an already-finalized period — it just
-- recomputes everything from the current expenses and re-saves,
-- which is how you "re-edit" a finalized month (edit its
-- expenses on the Manage Contributions page, then finalize
-- again). One limitation worth knowing: if a LATER period has
-- already carried the old surplus forward, re-finalizing an
-- earlier period won't cascade an updated surplus into it —
-- that later period would need a manual look if the numbers
-- shift enough to matter.
create or replace function public.admin_finalize_period(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date;
  v_total numeric;
  v_active_count int;
  v_due numeric;
  v_collected numeric;
  v_surplus numeric;
  v_next_month date;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  select month into v_month from periods where id = p_period_id;
  if v_month is null then
    raise exception 'Period not found.';
  end if;

  select coalesce(sum(amount), 0) into v_total from expenses where period_id = p_period_id;
  select count(*) into v_active_count from profiles where status = 'active';
  v_due := case when v_active_count > 0 then round(v_total / v_active_count, 2) else 0 end;

  select coalesce(sum(amount_claimed), 0) into v_collected
  from payment_submissions
  where period_id = p_period_id and status = 'approved';

  v_surplus := v_collected - v_total;

  update periods
  set total_expenses = v_total,
      active_member_count = v_active_count,
      amount_due_per_member = v_due,
      surplus_carried_out = v_surplus,
      status = 'finalized',
      finalized_at = now(),
      finalized_by = auth.uid()
  where id = p_period_id;

  insert into status_audit_log (actor_id, action, details)
  values (
    auth.uid(), 'period_finalized',
    jsonb_build_object('period_id', p_period_id, 'month', v_month, 'total_expenses', v_total, 'surplus', v_surplus)
  );

  -- Open next month's period automatically, carrying the surplus
  -- forward, if it doesn't already exist.
  v_next_month := (v_month + interval '1 month')::date;

  insert into periods (month, status, surplus_carried_in)
  values (v_next_month, 'open', v_surplus)
  on conflict (month) do nothing;
end;
$$;

grant execute on function public.admin_finalize_period to authenticated;

-- --- Admin write access to periods/expenses ---------------------
-- Not encrypted, so plain RLS policies are enough here — no RPC
-- wrapping needed like the functions above.

create policy "admins can insert periods"
  on periods for insert
  to authenticated
  with check (is_admin());

create policy "admins can update periods"
  on periods for update
  to authenticated
  using (is_admin());

create policy "admins can insert expenses"
  on expenses for insert
  to authenticated
  with check (is_admin());

create policy "admins can update expenses"
  on expenses for update
  to authenticated
  using (is_admin());

create policy "admins can delete expenses"
  on expenses for delete
  to authenticated
  using (is_admin());

-- --- status_audit_log ------------------------------------------
-- schema.sql turned RLS on for this table but never added a
-- single policy, which meant NOBODY could read it (not even an
-- admin) even though the admin_* functions above already write
-- to it. This is what makes the Dashboard's activity feed work.
create policy "admins can view the audit log"
  on status_audit_log for select
  to authenticated
  using (is_admin());
