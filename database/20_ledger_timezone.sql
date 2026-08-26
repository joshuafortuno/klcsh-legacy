-- ============================================================
-- LEDGER TIMEZONE FIX — display the contribution date in Manila
-- time, not the database's default (UTC)
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste
-- > Run. Needs 19_ledger_sort_precision.sql already run (this
-- replaces public_contribution_ledger() from there).
--
-- Bug this fixes: contributed_on was computed as
-- coalesce(reviewed_at, submitted_at)::date — casting a timestamptz
-- straight to date uses the database's own timezone (UTC on
-- Supabase), not the Philippines'. A payment approved anywhere from
-- 8:00 PM to midnight Manila time (UTC+8) is still morning/afternoon
-- the same UTC day, so it displayed as the day BEFORE it actually
-- happened in Manila. Converting to Asia/Manila before truncating
-- to a date fixes this. sort_at is unaffected — a timestamptz is an
-- absolute instant regardless of timezone, so chronological sort
-- order was never wrong, only the displayed date was.
-- ============================================================

drop function if exists public.public_contribution_ledger();

create or replace function public.public_contribution_ledger()
returns table (
  contributor_name text,
  amount numeric,
  contributed_on date,
  sort_at timestamptz,
  target_label text,
  rank_purchased member_rank,
  battlepass_purchased boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    contributor_name, amount, contributed_on,
    contributed_on::timestamptz,
    null::text, null::member_rank, false
  from legacy_contributions

  union all

  select
    p.in_game_name,
    ps.amount_claimed,
    (coalesce(ps.reviewed_at, ps.submitted_at) at time zone 'Asia/Manila')::date,
    coalesce(ps.reviewed_at, ps.submitted_at),
    case when ps.period_id is not null then 'This month''s dues' else sg.title end,
    ps.rank_purchased,
    ps.battlepass_purchased
  from payment_submissions ps
  join profiles p on p.id = ps.user_id
  left join side_goals sg on sg.id = ps.side_goal_id
  where ps.status = 'approved';
$$;

grant execute on function public.public_contribution_ledger to authenticated;
