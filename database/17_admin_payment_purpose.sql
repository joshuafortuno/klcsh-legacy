-- ============================================================
-- ADMIN PAYMENT PURPOSE — surface rank/battlepass on the admin
-- side, same as the public ledger already does
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste
-- > Run. Needs 11_shop_core.sql already run (that's what added
-- payment_submissions.rank_purchased/battlepass_purchased).
--
-- Bug this fixes: 13_shop_display.sql extended the PUBLIC ledger
-- function (public_contribution_ledger()) to report rank_purchased/
-- battlepass_purchased, so the /contributions page and ledger.js
-- already show "VIP · Legacy Pass"-style tags. admin_list_payment_
-- submissions() — used by both the admin Contributions page and
-- Notifications' Pending payments panel — never got the same
-- treatment, so admins reviewing or browsing payments had no way to
-- see what a submission actually included, only its dues/side-goal
-- target. This adds the same two columns there.
--
-- Adding columns to a RETURNS TABLE function changes its return
-- type, which CREATE OR REPLACE FUNCTION can't do on its own —
-- same reason 13_shop_display.sql had to drop public_contribution_
-- ledger() first.
-- ============================================================

drop function if exists public.admin_list_payment_submissions(payment_status);

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
  side_goal_title text,
  rank_purchased member_rank,
  battlepass_purchased boolean
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
      per.month, sg.title,
      ps.rank_purchased, ps.battlepass_purchased
    from payment_submissions ps
    join profiles p on p.id = ps.user_id
    left join periods per on per.id = ps.period_id
    left join side_goals sg on sg.id = ps.side_goal_id
    where p_status is null or ps.status = p_status
    order by ps.submitted_at desc;
end;
$$;

grant execute on function public.admin_list_payment_submissions to authenticated;
