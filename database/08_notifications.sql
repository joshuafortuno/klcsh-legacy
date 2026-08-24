-- ============================================================
-- NOTIFICATIONS + generalized status requests (leave/inactive/reactivate)
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query >
-- paste > Run. Needs 04_admin_dashboard.sql already run (uses
-- is_admin()).
--
-- If "create extension pg_cron" near the bottom fails, your
-- project may need it turned on first via Database > Extensions
-- in the dashboard, then re-run just that section.
--
-- What this adds:
--   1. leave_requests gets a `requested_status` column — it used
--      to only ever mean "I want to leave" (status -> 'left').
--      Now it can also mean "make me inactive" or "make me active
--      again" (reactivation), same table, same review flow, just
--      a column saying which one. The table keeps its old name to
--      avoid unnecessary churn, even though it does more now.
--   2. notifications — one row per thing a member should see:
--      payment approved/rejected, a status request approved/
--      denied, or a due-date reminder. Self-view only; only
--      `read` can be updated directly by the owner, everything
--      else is written by admin functions or the scheduled job
--      below (no INSERT policy for members at all).
--   3. admin_approve_payment / admin_reject_payment /
--      admin_approve_leave_request / admin_deny_leave_request all
--      get re-defined to also insert the matching notification.
--      admin_list_leave_requests now also returns requested_status
--      so the admin can see WHAT'S being asked before approving.
--   4. submit_status_request() — how a member asks to leave, go
--      inactive, or reactivate. Blocks a second request while one
--      is already pending.
--   5. generate_period_notifications() + a pg_cron schedule — the
--      only piece of this project that runs on a timer rather than
--      in response to a click. Checks once a day whether today is
--      5-days-before / on / 5-days-after the current period's due
--      date (still the 25th), and notifies active members who
--      haven't submitted anything yet for it (a pending submission
--      counts as already handled).
--   6. Realtime enabled for notifications, so the bell can update
--      without a page reload.
-- ============================================================

-- ------------------------------------------------------------
-- LEAVE_REQUESTS: generalize beyond just "leave"
-- ------------------------------------------------------------
alter table leave_requests
  add column requested_status member_status not null default 'left';

-- One pending request per member at a time — stops someone
-- double-submitting while waiting on a review.
create unique index one_pending_status_request_per_user
  on leave_requests (user_id)
  where status = 'pending';

-- Members could previously insert with no column restriction at
-- all (schema.sql's original policy). Same fix as elsewhere:
-- restrict which columns a direct client INSERT may set. status
-- keeps its 'pending' default, reviewed_by/reviewed_at stay null
-- until an admin acts. (submit_status_request() below is the
-- actual path the frontend uses, but this keeps the grant honest
-- either way.)
revoke insert on leave_requests from authenticated;
grant insert (user_id, requested_status) on leave_requests to authenticated;

-- ------------------------------------------------------------
-- NOTIFICATIONS
-- ------------------------------------------------------------
create type notification_type as enum (
  'payment_approved',
  'payment_rejected',
  'status_request_approved',
  'status_request_denied',
  'upcoming_due',
  'due_today',
  'late_contribution'
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type notification_type not null,
  message text not null,
  reference_id uuid, -- points at a payment_submissions or leave_requests row, whichever type applies — no FK, since it can be either table
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;

create policy "users can view their own notifications"
  on notifications for select
  to authenticated
  using (auth.uid() = user_id);

-- Only the read flag is theirs to change — everything else is
-- written by admin functions or the scheduled job, never the
-- client directly (no INSERT policy at all here on purpose).
create policy "users can mark their own notifications read"
  on notifications for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke update on notifications from authenticated;
grant update (read) on notifications to authenticated;

-- Lets the bell update live instead of only on page load. Guarded
-- so re-running this file doesn't error if it's already added.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;

-- ------------------------------------------------------------
-- admin_approve_payment / admin_reject_payment — now also notify
-- ------------------------------------------------------------
create or replace function public.admin_approve_payment(p_submission_id uuid)
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

  update payment_submissions
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_submission_id and status = 'pending'
  returning user_id, amount_claimed into v_user_id, v_amount;

  if v_user_id is null then
    raise exception 'Payment submission not found or already reviewed.';
  end if;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), v_user_id, 'payment_approved', jsonb_build_object('submission_id', p_submission_id));

  insert into notifications (user_id, type, message, reference_id)
  values (
    v_user_id, 'payment_approved',
    'Your ₱' || v_amount || ' payment was approved. Thanks for contributing!',
    p_submission_id
  );
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
  v_amount numeric;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  update payment_submissions
  set status = 'rejected', rejection_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_submission_id and status = 'pending'
  returning user_id, amount_claimed into v_user_id, v_amount;

  if v_user_id is null then
    raise exception 'Payment submission not found or already reviewed.';
  end if;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), v_user_id, 'payment_rejected', jsonb_build_object('submission_id', p_submission_id, 'reason', p_reason));

  insert into notifications (user_id, type, message, reference_id)
  values (
    v_user_id, 'payment_rejected',
    'Your ₱' || v_amount || ' payment was rejected: "' || p_reason || '"',
    p_submission_id
  );
end;
$$;

grant execute on function public.admin_reject_payment to authenticated;

-- ------------------------------------------------------------
-- Leave/inactive/reactivate requests — now generalized
-- ------------------------------------------------------------
-- Return columns changed (added requested_status) — CREATE OR
-- REPLACE can't change a function's return signature, so the old
-- one has to be dropped first or this errors.
drop function if exists public.admin_list_leave_requests(leave_request_status);

create or replace function public.admin_list_leave_requests(p_status leave_request_status default 'pending')
returns table (
  id uuid,
  user_id uuid,
  in_game_name text,
  requested_status member_status,
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
    select lr.id, lr.user_id, p.in_game_name, lr.requested_status, lr.status, lr.requested_at
    from leave_requests lr
    join profiles p on p.id = lr.user_id
    where p_status is null or lr.status = p_status
    order by lr.requested_at desc;
end;
$$;

grant execute on function public.admin_list_leave_requests to authenticated;

create or replace function public.admin_approve_leave_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_requested_status member_status;
  v_old_status member_status;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  select user_id, requested_status into v_user_id, v_requested_status
  from leave_requests where id = p_request_id and status = 'pending';

  if v_user_id is null then
    raise exception 'Request not found or already reviewed.';
  end if;

  select status into v_old_status from profiles where id = v_user_id;

  update leave_requests
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id;

  update profiles
  set status = v_requested_status,
      left_at = case when v_requested_status = 'left' then now() else null end
  where id = v_user_id;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (
    auth.uid(), v_user_id, 'status_change',
    jsonb_build_object('from', v_old_status, 'to', v_requested_status, 'reason', 'status_request_approved')
  );

  insert into notifications (user_id, type, message, reference_id)
  values (
    v_user_id, 'status_request_approved',
    'Your request to become ' || v_requested_status || ' was approved.',
    p_request_id
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
declare
  v_user_id uuid;
  v_requested_status member_status;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  update leave_requests
  set status = 'denied', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_request_id and status = 'pending'
  returning user_id, requested_status into v_user_id, v_requested_status;

  if v_user_id is null then
    raise exception 'Request not found or already reviewed.';
  end if;

  insert into notifications (user_id, type, message, reference_id)
  values (
    v_user_id, 'status_request_denied',
    'Your request to become ' || v_requested_status || ' was denied.',
    p_request_id
  );
end;
$$;

grant execute on function public.admin_deny_leave_request to authenticated;

-- ------------------------------------------------------------
-- Member-facing: submit a status change request. Wrapped in a
-- function (rather than relying purely on the column-restricted
-- grant above) so "already have one pending" gets a clean error
-- message instead of a raw unique-constraint violation.
-- ------------------------------------------------------------
create or replace function public.submit_status_request(p_requested_status member_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from leave_requests where user_id = auth.uid() and status = 'pending') then
    raise exception 'You already have a pending request.';
  end if;

  insert into leave_requests (user_id, requested_status)
  values (auth.uid(), p_requested_status);
end;
$$;

grant execute on function public.submit_status_request to authenticated;

-- ------------------------------------------------------------
-- Scheduled due-date reminders
-- ------------------------------------------------------------
create extension if not exists pg_cron;

create or replace function public.generate_period_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period periods;
  v_due_date date;
  v_days_diff int;
  v_notif_type notification_type;
  v_total numeric;
  v_active_count int;
  v_due_per_member numeric;
  v_message text;
begin
  select * into v_period from periods where status = 'open' order by month desc limit 1;
  if not found then
    return;
  end if;

  v_due_date := (v_period.month + interval '24 days')::date; -- the 25th
  v_days_diff := v_due_date - current_date;

  if v_days_diff = 5 then
    v_notif_type := 'upcoming_due';
  elsif v_days_diff = 0 then
    v_notif_type := 'due_today';
  elsif v_days_diff = -5 then
    v_notif_type := 'late_contribution';
  else
    return; -- not one of the three notification days
  end if;

  select coalesce(sum(amount), 0) into v_total from expenses where period_id = v_period.id;
  select count(*) into v_active_count from profiles where status = 'active';
  v_due_per_member := case when v_active_count > 0 then round(v_total / v_active_count, 2) else 0 end;

  v_message := case v_notif_type
    when 'upcoming_due' then 'Your ₱' || v_due_per_member || ' contribution is due in 5 days.'
    when 'due_today' then 'Your ₱' || v_due_per_member || ' contribution is due today.'
    else 'Your ₱' || v_due_per_member || ' contribution is now 5 days late.'
  end;

  -- "Haven't paid" = zero submissions of ANY status for this
  -- period — a pending one already counts as handled. Also
  -- guarded against sending the same reminder twice if this job
  -- somehow runs more than once on the same day.
  insert into notifications (user_id, type, message, reference_id)
  select p.id, v_notif_type, v_message, v_period.id
  from profiles p
  where p.status = 'active'
    and not exists (
      select 1 from payment_submissions ps
      where ps.user_id = p.id and ps.period_id = v_period.id
    )
    and not exists (
      select 1 from notifications n
      where n.user_id = p.id and n.type = v_notif_type and n.reference_id = v_period.id
        and n.created_at::date = current_date
    );
end;
$$;

-- 1am UTC = 9am Philippine time (UTC+8). Re-running this is safe —
-- cron.schedule() updates the existing job by name instead of
-- erroring if 'daily-period-notifications' already exists.
select cron.schedule(
  'daily-period-notifications',
  '0 1 * * *',
  $$select generate_period_notifications();$$
);
