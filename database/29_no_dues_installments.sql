-- ============================================================
-- NO DUES INSTALLMENTS — a dues payment must cover the full
-- per-member amount in one submission, and only one at a time
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste
-- > Run. Needs 24_rank_upgrade_logic.sql already run (this replaces
-- submit_payment() from there).
--
-- Previously a dues-targeted payment (p_period_id set) could be for
-- any amount, and nothing stopped a member submitting several across
-- a period — a de facto installment plan the frontend never actually
-- offered as a feature, just an emergent possibility from "Amount
-- sent" being a free-form field. That made "how much of this period
-- came from dues vs. shop purchases" ambiguous for any member who
-- split their dues across multiple payments or underpaid.
--
-- Two new checks when p_period_id is set:
--   1. p_amount must be at least this period's live per-member due
--      amount (same formula admin_finalize_period() snapshots at
--      close: total expenses so far / active member count). Paying
--      more is still fine — that's dues + a bundled shop purchase in
--      one submission, unaffected by this.
--   2. Reject if the member already has a pending or approved
--      dues-targeted payment for this period. A rejected one doesn't
--      count — that's a retry, not an installment.
--
-- Net effect: at most one dues payment per member per period, always
-- covering the full due amount. See admin_dashboard_totals() in
-- 30_admin_dashboard_totals.sql for what this makes possible —
-- contribution vs. shop can now be split exactly per payment
-- (amount_claimed capped at the due amount vs. whatever's left over)
-- instead of needing to guess at a mixed/partial payment.
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
  v_current_rank member_rank;
  v_current_rank_expires_at timestamptz;
  v_period_expenses numeric;
  v_active_count int;
  v_due_amount numeric;
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

  if p_period_id is not null then
    if exists (
      select 1 from payment_submissions
      where user_id = auth.uid() and period_id = p_period_id and status in ('pending', 'approved')
    ) then
      raise exception 'You already have a dues payment for this period — no need for another one.';
    end if;

    select coalesce(sum(amount), 0) into v_period_expenses from expenses where period_id = p_period_id;
    select count(*) into v_active_count from profiles where status = 'active';
    v_due_amount := case when v_active_count > 0 then round(v_period_expenses / v_active_count, 2) else 0 end;

    if p_amount < v_due_amount then
      raise exception 'This period''s dues are ₱% per member — a dues payment needs to cover at least that much.', v_due_amount;
    end if;
  end if;

  if p_side_goal_id is not null and not exists (
    select 1 from side_goals where id = p_side_goal_id and status = 'active'
  ) then
    raise exception 'This goal is no longer accepting contributions.';
  end if;

  if p_rank_purchased is not null and p_rank_purchased = 'none' then
    raise exception 'Choose an actual rank, or leave it unselected.';
  end if;

  -- Catches a doomed-to-fail submission immediately (an MVP holder
  -- trying to submit for VIP, or someone with an active pass trying
  -- to buy another) rather than letting it sit pending until an
  -- admin reviews it and only then discovers it can't be approved —
  -- see apply_shop_purchase(), which enforces the same rules for
  -- real at approval time.
  if p_rank_purchased is not null then
    select rank, rank_expires_at into v_current_rank, v_current_rank_expires_at
    from profiles where id = auth.uid();

    if v_current_rank_expires_at is not null and v_current_rank_expires_at > now()
       and v_current_rank = 'mvp' and p_rank_purchased = 'vip' then
      raise exception 'You already have MVP — it needs to expire before you can select VIP.';
    end if;
  end if;

  if p_battlepass_purchased and exists (
    select 1 from battlepass_cycles where user_id = auth.uid() and expires_at > now()
  ) then
    raise exception 'You already have an active Legacy Pass — wait for it to expire before buying another.';
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
