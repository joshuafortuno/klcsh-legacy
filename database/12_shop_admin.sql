-- ============================================================
-- SHOP ADMIN — expired-rank review, pending-delivery review, and
-- member-facing rank/battlepass notifications
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query >
-- paste > Run. Needs 11_shop_core.sql already run.
--
-- STEP 2 of the shop feature.
--
-- What this adds:
--   1. admin_list_expired_ranks() / admin_clear_expired_rank() —
--      the admin's manual "acknowledge and clear" step for a
--      lapsed rank. Nothing auto-clears a rank; this is the only
--      way rank goes back to 'none' once it's expired.
--   2. admin_list_pending_deliveries() / admin_mark_delivery_delivered()
--      — a manual fallback over the same in_game_deliveries queue
--      the addon-bridge will eventually work through automatically.
--      Needed regardless of the addon, since it doesn't exist yet.
--   3. admin_pending_counts() extended (signature changed, drop
--      first) to also report expired_ranks and pending_deliveries,
--      so the dashboard badge reflects all four actionable queues.
--   4. Two new notification_type values + generate_rank_battlepass_notifications(),
--      scheduled daily via pg_cron: warns a member 3 days before
--      their rank expires, and reminds them once a day while a
--      Legacy Pass day is claimable and unclaimed. REVOKEd from
--      authenticated/anon/public, same as the existing daily job —
--      cron-only, not something a member should be able to trigger.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Expired ranks — admin review queue
-- ------------------------------------------------------------
create or replace function public.admin_list_expired_ranks()
returns table (id uuid, in_game_name text, rank member_rank, rank_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  return query
    select p.id, p.in_game_name, p.rank, p.rank_expires_at
    from profiles p
    where p.rank <> 'none' and p.rank_expires_at < now()
    order by p.rank_expires_at asc;
end;
$$;

grant execute on function public.admin_list_expired_ranks to authenticated;

create or replace function public.admin_clear_expired_rank(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_rank member_rank;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  select rank into v_old_rank from profiles where id = p_user_id;
  if v_old_rank is null or v_old_rank = 'none' then
    raise exception 'This member has no rank to clear.';
  end if;

  update profiles set rank = 'none', rank_expires_at = null where id = p_user_id;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), p_user_id, 'rank_cleared', jsonb_build_object('previous_rank', v_old_rank));
end;
$$;

grant execute on function public.admin_clear_expired_rank to authenticated;

-- ------------------------------------------------------------
-- 2. Pending in-game deliveries — manual admin fallback
-- ------------------------------------------------------------
create or replace function public.admin_list_pending_deliveries()
returns table (id uuid, in_game_name text, reward_type text, amount numeric, source text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  return query
    select d.id, d.in_game_name, d.reward_type, d.amount, d.source, d.created_at
    from in_game_deliveries d
    where d.status = 'pending'
    order by d.created_at asc;
end;
$$;

grant execute on function public.admin_list_pending_deliveries to authenticated;

create or replace function public.admin_mark_delivery_delivered(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  update in_game_deliveries
  set status = 'delivered', delivered_at = now(), delivered_by = auth.uid()
  where id = p_delivery_id and status = 'pending';

  if not found then
    raise exception 'Delivery not found or already delivered.';
  end if;
end;
$$;

grant execute on function public.admin_mark_delivery_delivered to authenticated;

-- ------------------------------------------------------------
-- 3. admin_pending_counts() — extended (signature changed, drop first)
-- ------------------------------------------------------------
drop function if exists public.admin_pending_counts();

create or replace function public.admin_pending_counts()
returns table (
  pending_payments int,
  pending_leave_requests int,
  expired_ranks int,
  pending_deliveries int
)
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
      (select count(*)::int from leave_requests where status = 'pending'),
      (select count(*)::int from profiles where rank <> 'none' and rank_expires_at < now()),
      (select count(*)::int from in_game_deliveries where status = 'pending');
end;
$$;

grant execute on function public.admin_pending_counts to authenticated;

-- ------------------------------------------------------------
-- 4. Member-facing notifications: rank expiring soon, Legacy Pass
--    claim available
-- ------------------------------------------------------------
alter type notification_type add value if not exists 'rank_expiring';
alter type notification_type add value if not exists 'battlepass_claim_available';

create or replace function public.generate_rank_battlepass_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- Ranks expiring in exactly 3 days — one heads-up, not a repeat every day.
  for r in
    select id, rank from profiles
    where rank <> 'none'
      and rank_expires_at::date = (current_date + 3)
  loop
    if not exists (
      select 1 from notifications
      where user_id = r.id and type = 'rank_expiring' and created_at::date = current_date
    ) then
      insert into notifications (user_id, type, message)
      values (r.id, 'rank_expiring', 'Your ' || upper(r.rank::text) || ' rank expires in 3 days — renew to keep it.');
    end if;
  end loop;

  -- Legacy Pass: a gentle daily reminder while today's frontier day is
  -- still unclaimed — reference_id ties it to the specific cycle so a
  -- finished/expired cycle can't somehow re-trigger this.
  for r in
    select bc.id as cycle_id, bc.user_id,
      least(31, extract(day from now() - bc.started_at)::int + 1) as elapsed_day
    from battlepass_cycles bc
    where bc.expires_at > now()
  loop
    if not exists (select 1 from battlepass_claims where cycle_id = r.cycle_id and day_number = r.elapsed_day)
       and not exists (
         select 1 from notifications
         where user_id = r.user_id and type = 'battlepass_claim_available'
           and reference_id = r.cycle_id and created_at::date = current_date
       )
    then
      insert into notifications (user_id, type, message, reference_id)
      values (r.user_id, 'battlepass_claim_available', 'Your Legacy Pass has a reward ready to claim!', r.cycle_id);
    end if;
  end loop;
end;
$$;

select cron.schedule(
  'daily-rank-battlepass-notifications',
  '0 1 * * *',
  $$select generate_rank_battlepass_notifications();$$
);

revoke execute on function public.generate_rank_battlepass_notifications() from public, authenticated, anon;
