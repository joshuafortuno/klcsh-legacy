-- ============================================================
-- PUBLIC CONTRIBUTION LEDGER — union legacy history + live payments
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query >
-- paste > Run. Needs schema.sql and 04_admin_dashboard.sql
-- (05_legacy_contributions.sql too, for the table this reads from)
-- already run.
--
-- Bug this fixes: the homepage's "Raised all time" stat and the
-- public /contributions "Full Ledger" page both queried
-- legacy_contributions directly — the one-time pre-launch import.
-- Neither ever included real payment_submissions rows, even
-- approved ones, so both numbers silently froze at whatever was
-- true before the site went live, despite the ledger page's own
-- copy claiming it "updates automatically the moment a payment
-- clears." A plain member can't fix this by querying
-- payment_submissions directly either — RLS only lets you see your
-- own rows there, by design (that's what stops a member from
-- browsing everyone else's payment history).
--
-- The fix: one function returning the same shape as
-- legacy_contributions (name, amount, date), unioning that table
-- with every APPROVED payment_submissions row (joined to profiles
-- for the in-game name). SECURITY DEFINER so it can read
-- payment_submissions rows that aren't the caller's own, but it
-- only ever returns approved amounts + names — the same kind of
-- information legacy_contributions already exposes to everyone,
-- nothing pending/rejected/encrypted leaks through.
-- ============================================================

create or replace function public.public_contribution_ledger()
returns table (
  contributor_name text,
  amount numeric,
  contributed_on date
)
language sql
security definer
stable
set search_path = public
as $$
  select contributor_name, amount, contributed_on
  from legacy_contributions

  union all

  select p.in_game_name, ps.amount_claimed, coalesce(ps.reviewed_at, ps.submitted_at)::date
  from payment_submissions ps
  join profiles p on p.id = ps.user_id
  where ps.status = 'approved';
$$;

grant execute on function public.public_contribution_ledger to authenticated;
