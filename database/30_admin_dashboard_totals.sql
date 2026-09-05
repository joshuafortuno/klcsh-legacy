-- ============================================================
-- ADMIN DASHBOARD TOTALS — all-time / contribution-only / shop-only
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste
-- > Run. Needs 29_no_dues_installments.sql already run (relies on
-- there being at most one dues payment per member per period, so a
-- payment's contribution portion can be computed exactly rather than
-- guessed at).
--
-- admin_dashboard_totals() — one admin-only RPC returning three
-- numbers:
--   all_time_total     — every approved payment ever, plus the
--                         pre-launch legacy_contributions import.
--                         Same total the homepage's "Raised all
--                         time" stat already shows, just exposed to
--                         the admin dashboard too.
--   contribution_total — the "monthly dues" portion of all_time_total.
--   shop_total          — everything else: VIP/MVP, the Legacy Pass,
--                         and side-goal ("mini goal") contributions.
--
-- How a payment splits: if it's dues-targeted (period_id set), the
-- contribution portion is capped at that period's per-member due
-- amount (finalized periods use the amount_due_per_member snapshot
-- taken at close; the still-open period is computed live with the
-- same formula) — anything paid beyond that in the same submission
-- (a bundled rank/battlepass purchase) falls to shop_total instead.
-- Since 29_no_dues_installments.sql guarantees a dues payment always
-- covers at least the due amount and there's only ever one per
-- member per period, this split is exact, not an estimate. A payment
-- with no period_id (side goal or shop-only) has no dues base to
-- subtract, so its full amount goes to shop_total. legacy_contributions
-- rows predate the shop entirely, so they count fully as contribution.
-- ============================================================

create or replace function public.admin_dashboard_totals()
returns table (
  all_time_total numeric,
  contribution_total numeric,
  shop_total numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_open_period_id uuid;
  v_open_expenses numeric;
  v_active_count int;
  v_open_due numeric := 0;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  select id into v_open_period_id from periods where status = 'open' limit 1;

  if v_open_period_id is not null then
    select coalesce(sum(amount), 0) into v_open_expenses from expenses where period_id = v_open_period_id;
    select count(*) into v_active_count from profiles where status = 'active';
    v_open_due := case when v_active_count > 0 then round(v_open_expenses / v_active_count, 2) else 0 end;
  end if;

  return query
  with payment_split as (
    select
      ps.amount_claimed,
      case
        when ps.period_id is not null then
          least(
            ps.amount_claimed,
            coalesce(p.amount_due_per_member, case when ps.period_id = v_open_period_id then v_open_due else 0 end)
          )
        else 0
      end as contribution_amt
    from payment_submissions ps
    left join periods p on p.id = ps.period_id
    where ps.status = 'approved'
  ),
  payment_totals as (
    select
      coalesce(sum(amount_claimed), 0) as payments_total,
      coalesce(sum(contribution_amt), 0) as payments_contribution
    from payment_split
  ),
  legacy_totals as (
    select coalesce(sum(amount), 0) as legacy_total from legacy_contributions
  )
  select
    pt.payments_total + lt.legacy_total,
    pt.payments_contribution + lt.legacy_total,
    pt.payments_total - pt.payments_contribution
  from payment_totals pt, legacy_totals lt;
end;
$$;

grant execute on function public.admin_dashboard_totals to authenticated;
