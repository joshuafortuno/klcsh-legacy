-- ============================================================
-- SHOP DISPLAY — public battlepass-holder lookup + ledger breakdown
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query >
-- paste > Run. Needs 11_shop_core.sql and 09_public_ledger.sql
-- already run.
--
-- STEP 4 of the shop feature (frontend: Contributors badges +
-- ledger breakdown).
--
-- What this adds:
--   1. public_active_battlepass_holders() — a public aggregate
--      (just user_ids with a currently-active cycle), same
--      "aggregate only, never the underlying rows" pattern as
--      period_progress()/side_goal_progress(). battlepass_cycles
--      itself stays self-view-only (started_at/expires_at aren't
--      anyone else's business), but "does this person currently
--      have a pass" is exactly the kind of public roster fact the
--      Contributors page already shows for rank.
--   2. public_contribution_ledger() extended (return shape changed,
--      drop first) to also report what a live payment was actually
--      for — target_label, rank_purchased, battlepass_purchased —
--      so the public ledger can show the same breakdown a member
--      sees on their own My Contributions page. Legacy
--      (pre-launch) rows don't have this detail, so they report
--      null/false and the frontend just shows them plainly, like
--      it always has.
-- ============================================================

create or replace function public.public_active_battlepass_holders()
returns table (user_id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select distinct user_id
  from battlepass_cycles
  where expires_at > now();
$$;

grant execute on function public.public_active_battlepass_holders to authenticated;

drop function if exists public.public_contribution_ledger();

create or replace function public.public_contribution_ledger()
returns table (
  contributor_name text,
  amount numeric,
  contributed_on date,
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
    null::text, null::member_rank, false
  from legacy_contributions

  union all

  select
    p.in_game_name,
    ps.amount_claimed,
    coalesce(ps.reviewed_at, ps.submitted_at)::date,
    case when ps.period_id is not null then 'This month''s dues' else sg.title end,
    ps.rank_purchased,
    ps.battlepass_purchased
  from payment_submissions ps
  join profiles p on p.id = ps.user_id
  left join side_goals sg on sg.id = ps.side_goal_id
  where ps.status = 'approved';
$$;

grant execute on function public.public_contribution_ledger to authenticated;
