-- ============================================================
-- SHOP-ONLY PAYMENTS — let a payment target neither a period nor a
-- side goal, as long as it's actually buying something (a rank
-- and/or the Legacy Pass)
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste
-- > Run. Needs everything through 15_uniqueness_constraints.sql
-- already run (this replaces submit_payment() from there).
--
-- submit_payment() used to require exactly one of p_period_id /
-- p_side_goal_id — fine while every payment was a dues or
-- side-goal contribution, but the Shop lets a member buy a rank or
-- the Legacy Pass on its own, with no dues/side-goal component at
-- all. The old rule made that impossible to submit (the frontend's
-- "What's this for?" picker had no way to express it either — see
-- pay.html/pay.js's new "None" option). Now: still at most one of
-- period/side-goal (never both), but neither is required as long
-- as a rank or the battlepass is actually being purchased — a
-- payment for literally nothing is still rejected.
-- ============================================================

create or replace function public.submit_payment(
  p_amount numeric,
  p_gcash_ref text,
  p_screenshot_path text,
  p_period_id uuid default null,
  p_side_goal_id uuid default null,
  p_rank_purchased member_rank default null,
  p_battlepass_purchased boolean default false,
  p_discount_applied numeric default 0
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_balance numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than 0.';
  end if;

  if p_period_id is not null and p_side_goal_id is not null then
    raise exception 'Choose at most one of a period or a side goal — not both.';
  end if;

  if p_period_id is null and p_side_goal_id is null
     and p_rank_purchased is null and not p_battlepass_purchased then
    raise exception 'Choose what this payment is for — dues, a side goal, or a shop purchase.';
  end if;

  if p_period_id is not null and not exists (
    select 1 from periods where id = p_period_id and status = 'open'
  ) then
    raise exception 'This period is no longer open for contributions.';
  end if;

  if p_side_goal_id is not null and not exists (
    select 1 from side_goals where id = p_side_goal_id and status = 'active'
  ) then
    raise exception 'This goal is no longer accepting contributions.';
  end if;

  if p_rank_purchased is not null and p_rank_purchased = 'none' then
    raise exception 'Choose an actual rank, or leave it unselected.';
  end if;

  if p_discount_applied < 0 then
    raise exception 'Discount applied can''t be negative.';
  end if;

  if p_discount_applied > 0 then
    select discount_credits into v_balance from profiles where id = auth.uid();
    if p_discount_applied > v_balance then
      raise exception 'You don''t have that much discount credit available.';
    end if;
    update profiles set discount_credits = discount_credits - p_discount_applied where id = auth.uid();
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'profile_encryption_key';

  if v_key is null then
    raise exception 'Encryption key not found in Vault.';
  end if;

  insert into payment_submissions (
    user_id, period_id, side_goal_id, amount_claimed, gcash_ref_enc, gcash_ref_hash, screenshot_url, status,
    rank_purchased, battlepass_purchased, discount_applied
  ) values (
    auth.uid(), p_period_id, p_side_goal_id, p_amount, pgp_sym_encrypt(p_gcash_ref, v_key),
    md5(lower(trim(p_gcash_ref))), p_screenshot_path, 'pending',
    p_rank_purchased, p_battlepass_purchased, p_discount_applied
  );
exception
  when unique_violation then
    raise exception 'This GCash reference number has already been submitted.';
end;
$$;

grant execute on function public.submit_payment to authenticated;
