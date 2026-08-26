-- ============================================================
-- SHORTEN DUES LABEL — "Dues" instead of "This month's dues" on the
-- public ledger's tag badges
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste
-- > Run. Needs 20_ledger_timezone.sql already run (this replaces
-- public_contribution_ledger() from there).
--
-- Purely cosmetic — "This month's dues" reads fine as a sentence but
-- is a long badge to sit next to "VIP"/"Legacy Pass" on a tag row.
-- Matches the short "Dues" wording admin-contributions.js's Purpose
-- column already settled on for the same concept.
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
    case when ps.period_id is not null then 'Dues' else sg.title end,
    ps.rank_purchased,
    ps.battlepass_purchased
  from payment_submissions ps
  join profiles p on p.id = ps.user_id
  left join side_goals sg on sg.id = ps.side_goal_id
  where ps.status = 'approved';
$$;

grant execute on function public.public_contribution_ledger to authenticated;
