-- ============================================================
-- LEDGER SORT PRECISION — sort the public ledger by the real
-- moment a payment cleared, not just its calendar day
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste
-- > Run. Needs 13_shop_display.sql already run (this replaces
-- public_contribution_ledger() from there).
--
-- Bug this fixes: public_contribution_ledger() cast
-- coalesce(reviewed_at, submitted_at) down to ::date before
-- returning it, so ledger.js — which sorts client-side by that
-- value to put the newest contribution first — had no way to tell
-- two same-day payments apart. Whichever one happened to come back
-- first from the UNION ALL (arbitrary, not actually meaningful
-- order) stayed wherever it landed instead of the truly most recent
-- one sorting to the top. Adds a separate full-precision sort_at
-- column for ledger.js to sort by, while contributed_on (still
-- date-only) stays exactly as before for display. legacy_
-- contributions rows have no time-of-day on record at all, so they
-- get a midnight anchor on their own date — the best precision that
-- actually exists for that historical import.
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
    coalesce(ps.reviewed_at, ps.submitted_at)::date,
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
