-- ============================================================
-- RANK UPGRADE LOGIC — tier-aware rank grants, a shared grant
-- function used by every path that can give someone a rank/Legacy
-- Pass, and validation that catches a bad purchase before it's even
-- submitted rather than only at approval time
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste
-- > Run. Needs 22_manual_payment_time_precision.sql already run
-- (this replaces admin_approve_payment() from 11_shop_core.sql,
-- admin_create_payment() from 22, and submit_payment() from
-- 16_shop_only_payments.sql).
--
-- What this fixes:
--
--   1. admin_approve_payment() extended rank/battlepass on renewal
--      already, but it was tier-blind — buying VIP while holding
--      MVP would silently downgrade the rank while still adding 30
--      days, since nothing compared tiers. Now: MVP -> VIP is
--      rejected outright (must wait for MVP to expire), and VIP ->
--      MVP is a real upgrade — the member keeps 50% of their unused
--      VIP time as bonus days on top of the standard 30-day MVP
--      grant, rounded per spec (over .5 rounds up, .5 or under
--      rounds down) — rather than that remaining time just being
--      discarded.
--
--   2. Battlepass purchases used to always extend an active cycle
--      by adding to expires_at without moving started_at — but the
--      reward-track day counter is capped at 31 relative to
--      started_at, so any days stacked past that were paid for but
--      could never actually be claimed. Buying while already active
--      is rejected now instead of silently wasting money.
--
--   3. apply_shop_purchase() — the actual rank/battlepass-granting
--      logic — used to live only inside admin_approve_payment().
--      admin_create_payment() (the manual-entry feature) never
--      called anything like it, so a manually-recorded "member X
--      bought MVP" entry was cosmetic only — the member never
--      actually received MVP. Pulling this into one shared function
--      both paths call fixes that gap and means the upgrade/
--      duplicate-pass rules can't drift out of sync between them.
--      (admin_update_payment() deliberately does NOT call this —
--      editing an existing record, e.g. to fix a typo'd amount,
--      shouldn't re-trigger a real-world rank extension every time.)
--
--   4. submit_payment() now rejects the same invalid combinations
--      up front (an MVP holder trying to submit for VIP, or someone
--      with an active pass trying to buy another) — so a member
--      finds out immediately instead of submitting something that's
--      guaranteed to get rejected days later at approval time.
-- ============================================================

create or replace function public.apply_shop_purchase(
  p_user_id uuid,
  p_rank_purchased member_rank,
  p_battlepass_purchased boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_rank member_rank;
  v_current_rank_expires_at timestamptz;
  v_rank_active boolean;
  v_remaining_days numeric;
  v_bonus_raw numeric;
  v_bonus_days int;
  v_new_rank_expiry timestamptz;
  v_active_battlepass_expiry timestamptz;
begin
  if p_rank_purchased is not null then
    select rank, rank_expires_at into v_current_rank, v_current_rank_expires_at
    from profiles where id = p_user_id;

    v_rank_active := v_current_rank_expires_at is not null and v_current_rank_expires_at > now();

    if v_rank_active and v_current_rank = 'mvp' and p_rank_purchased = 'vip' then
      raise exception 'This member already has MVP — it needs to expire before VIP can be selected.';
    end if;

    if v_rank_active and v_current_rank = 'vip' and p_rank_purchased = 'mvp' then
      -- Upgrade: 50% of remaining VIP time carries over as bonus days
      -- on top of the standard 30-day MVP grant.
      v_remaining_days := extract(epoch from (v_current_rank_expires_at - now())) / 86400.0;
      v_bonus_raw := v_remaining_days * 0.5;
      v_bonus_days := case
        when (v_bonus_raw - floor(v_bonus_raw)) > 0.5 then ceil(v_bonus_raw)
        else floor(v_bonus_raw)
      end;
      v_new_rank_expiry := now() + interval '30 days' + make_interval(days => v_bonus_days);
    else
      -- Same-tier renewal, a fresh purchase, or picking a rank back
      -- up after a lapsed one — extend from whichever is later: now,
      -- or the existing expiry, so renewing early never loses time
      -- already paid for.
      v_new_rank_expiry := greatest(now(), coalesce(v_current_rank_expires_at, now())) + interval '30 days';
    end if;

    update profiles set rank = p_rank_purchased, rank_expires_at = v_new_rank_expiry where id = p_user_id;
  end if;

  if p_battlepass_purchased then
    select expires_at into v_active_battlepass_expiry
    from battlepass_cycles
    where user_id = p_user_id and expires_at > now()
    order by expires_at desc
    limit 1;

    if v_active_battlepass_expiry is not null then
      raise exception 'This member already has an active Legacy Pass — it needs to expire before another can be purchased.';
    end if;

    insert into battlepass_cycles (user_id, started_at, expires_at)
    values (p_user_id, now(), now() + interval '31 days');
  end if;
end;
$$;

-- Deliberately NOT granted to authenticated — only called internally
-- by the admin_* functions below (both SECURITY DEFINER, so the
-- inner call runs fine without a separate grant). Never meant to be
-- an RPC a client calls directly.

create or replace function public.admin_approve_payment(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_amount numeric;
  v_rank_purchased member_rank;
  v_battlepass_purchased boolean;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  update payment_submissions
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_submission_id and status = 'pending'
  returning user_id, amount_claimed, rank_purchased, battlepass_purchased
    into v_user_id, v_amount, v_rank_purchased, v_battlepass_purchased;

  if v_user_id is null then
    raise exception 'Payment submission not found or already reviewed.';
  end if;

  -- If this raises (downgrade attempt, duplicate active pass), the
  -- whole function aborts and the status update above rolls back
  -- too — the submission stays 'pending' rather than being marked
  -- approved when the actual grant never happened.
  perform apply_shop_purchase(v_user_id, v_rank_purchased, v_battlepass_purchased);

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), v_user_id, 'payment_approved', jsonb_build_object('submission_id', p_submission_id));

  insert into notifications (user_id, type, message, reference_id)
  values (
    v_user_id, 'payment_approved',
    'Your ₱' || v_amount || ' payment was approved. Thanks for contributing!',
    p_submission_id
  );
end;
$$;

grant execute on function public.admin_approve_payment to authenticated;

create or replace function public.admin_create_payment(
  p_user_id uuid,
  p_amount numeric,
  p_contributed_on date,
  p_period_id uuid default null,
  p_side_goal_id uuid default null,
  p_rank_purchased member_rank default null,
  p_battlepass_purchased boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than 0.';
  end if;

  if p_contributed_on is null then
    raise exception 'Enter the date this payment actually happened.';
  end if;

  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'Member not found.';
  end if;

  if p_period_id is not null and p_side_goal_id is not null then
    raise exception 'Choose at most one of a period or a side goal — not both.';
  end if;

  if p_period_id is null and p_side_goal_id is null
     and p_rank_purchased is null and not p_battlepass_purchased then
    raise exception 'Choose what this payment is for — dues, a side goal, or a shop purchase.';
  end if;

  if p_rank_purchased is not null and p_rank_purchased = 'none' then
    raise exception 'Choose an actual rank, or leave it unselected.';
  end if;

  v_at := (p_contributed_on::timestamp + (now() at time zone 'Asia/Manila')::time) at time zone 'Asia/Manila';

  insert into payment_submissions (
    user_id, period_id, side_goal_id, amount_claimed,
    status, rank_purchased, battlepass_purchased,
    submitted_at, reviewed_at, reviewed_by
  ) values (
    p_user_id, p_period_id, p_side_goal_id, p_amount,
    'approved', p_rank_purchased, p_battlepass_purchased,
    v_at, v_at, auth.uid()
  );

  perform apply_shop_purchase(p_user_id, p_rank_purchased, p_battlepass_purchased);

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), p_user_id, 'payment_manually_added', jsonb_build_object(
    'amount', p_amount, 'contributed_on', p_contributed_on,
    'rank_purchased', p_rank_purchased, 'battlepass_purchased', p_battlepass_purchased
  ));
end;
$$;

grant execute on function public.admin_create_payment to authenticated;

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
