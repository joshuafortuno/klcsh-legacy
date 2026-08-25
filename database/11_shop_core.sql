-- ============================================================
-- SHOP CORE — ranks, Legacy Pass (battlepass), discount credits,
-- and the addon-facing in-game delivery/rank-sync endpoints
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query >
-- paste > Run. Needs 09_public_ledger.sql and 10_hardening.sql
-- already run (uses the narrowed profiles SELECT grant pattern
-- from 10).
--
-- STEP 1 of the shop feature — schema + purchase/approval/claim
-- mechanics only. Admin-facing queues (expired ranks, pending
-- deliveries), the expiry/claim notification cron job, and the
-- frontend pages are separate follow-up steps, on purpose — this
-- file is already the biggest single piece.
--
-- What this adds:
--   1. profiles: rank, rank_expires_at, discount_credits.
--   2. site_settings: vip_price, mvp_price, battlepass_price —
--      admin-editable later, same pattern as the existing GCash
--      fields, so prices don't need a code deploy to change.
--   3. battlepass_reward_schedule — the 31-day reward table,
--      seeded once. battlepass_cycles — one row per purchased/
--      renewed 31-day cycle. battlepass_claims — one row per
--      claimed day, unique per cycle+day so a day can't be
--      double-claimed.
--   4. in_game_deliveries — the addon-ready pending/delivered
--      queue for rewards that need an in-game grant (claimblocks).
--      RLS enabled with NO policies for authenticated/anon on
--      purpose — nobody browses this except admins (via RPCs, a
--      later step) and the addon-bridge, which authenticates with
--      the service_role key and bypasses RLS entirely by design.
--   5. payment_submissions: rank_purchased, battlepass_purchased,
--      discount_applied — a submission can now optionally bundle a
--      rank and/or the pass on top of its dues/side-goal target,
--      approved or rejected as one combined unit.
--   6. submit_payment() extended to accept the rank/battlepass
--      choice and how much discount credit to apply — reserves the
--      credit immediately (so it can't be double-spent across two
--      pending submissions), refunded automatically if rejected.
--   7. admin_approve_payment()/admin_reject_payment() extended:
--      approval grants/extends the rank or battlepass cycle;
--      rejection refunds any reserved discount credit.
--   8. claim_battlepass_day() — the member-facing claim action.
--      Claimblocks rewards enqueue an in_game_deliveries row;
--      discount rewards credit the balance directly.
--   9. get_my_profile() extended to also return rank/expiry/
--      credits — kept off the broad profiles SELECT grant (same
--      privacy reasoning as real_name/discord_username from the
--      audit) since it's personal, not roster-public. `rank` alone
--      IS granted broadly, since the Contributors page needs to
--      show everyone's rank badge.
--  10. addon_list_pending_deliveries() / addon_mark_delivered() /
--      addon_list_current_ranks() — explicitly REVOKEd from
--      authenticated/anon/public. These exist ONLY for your
--      addon-bridge's service_role key to call; no logged-in
--      member should ever be able to call them directly (e.g. to
--      fraudulently mark their own delivery "done" without
--      receiving it).
-- ============================================================

-- ------------------------------------------------------------
-- 1. profiles: rank + credits
-- ------------------------------------------------------------
create type member_rank as enum ('none', 'vip', 'mvp');

alter table profiles add column rank member_rank not null default 'none';
alter table profiles add column rank_expires_at timestamptz;
alter table profiles add column discount_credits numeric(10, 2) not null default 0;

-- `rank` is public roster info (Contributors page shows it for
-- everyone); rank_expires_at/discount_credits are NOT broadly
-- granted — those stay self-only, via get_my_profile() below, same
-- privacy reasoning as real_name/discord_username in 10_hardening.sql.
grant select (rank) on profiles to authenticated;

-- ------------------------------------------------------------
-- 2. site_settings: admin-editable pricing
-- ------------------------------------------------------------
alter table site_settings add column vip_price numeric(10, 2) not null default 25;
alter table site_settings add column mvp_price numeric(10, 2) not null default 50;
alter table site_settings add column battlepass_price numeric(10, 2) not null default 100;

-- ------------------------------------------------------------
-- 3. Legacy Pass (battlepass) schema
-- ------------------------------------------------------------
create table battlepass_reward_schedule (
  day_number int primary key check (day_number between 1 and 31),
  reward_type text not null check (reward_type in ('claimblocks', 'discount')),
  reward_amount numeric(10, 2) not null
);

alter table battlepass_reward_schedule enable row level security;

create policy "battlepass reward schedule is viewable by all logged-in users"
  on battlepass_reward_schedule for select
  to authenticated
  using (true);

insert into battlepass_reward_schedule (day_number, reward_type, reward_amount) values
  (1, 'claimblocks', 50), (2, 'claimblocks', 50), (3, 'claimblocks', 50), (4, 'claimblocks', 50),
  (5, 'discount', 8),
  (6, 'claimblocks', 50), (7, 'claimblocks', 50), (8, 'claimblocks', 50), (9, 'claimblocks', 50),
  (10, 'discount', 8),
  (11, 'claimblocks', 50), (12, 'claimblocks', 50), (13, 'claimblocks', 50), (14, 'claimblocks', 50),
  (15, 'discount', 8),
  (16, 'claimblocks', 50), (17, 'claimblocks', 50), (18, 'claimblocks', 50), (19, 'claimblocks', 50),
  (20, 'discount', 8),
  (21, 'claimblocks', 50), (22, 'claimblocks', 50), (23, 'claimblocks', 50), (24, 'claimblocks', 50),
  (25, 'discount', 8),
  (26, 'claimblocks', 50), (27, 'claimblocks', 50), (28, 'claimblocks', 50), (29, 'claimblocks', 50),
  (30, 'discount', 10),
  (31, 'claimblocks', 1300);

create table battlepass_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table battlepass_cycles enable row level security;

create policy "users can view their own battlepass cycles"
  on battlepass_cycles for select
  to authenticated
  using (auth.uid() = user_id);

create table battlepass_claims (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references battlepass_cycles(id) on delete cascade,
  day_number int not null references battlepass_reward_schedule(day_number),
  reward_type text not null,
  reward_amount numeric(10, 2) not null,
  claimed_at timestamptz not null default now(),
  unique (cycle_id, day_number)
);

alter table battlepass_claims enable row level security;

create policy "users can view their own battlepass claims"
  on battlepass_claims for select
  to authenticated
  using (exists (select 1 from battlepass_cycles bc where bc.id = cycle_id and bc.user_id = auth.uid()));

-- ------------------------------------------------------------
-- 4. In-game delivery queue (addon-ready)
-- ------------------------------------------------------------
create type delivery_status as enum ('pending', 'delivered');

create table in_game_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  in_game_name text not null, -- snapshot at creation time — the addon matches by name, not uuid
  reward_type text not null,
  amount numeric(10, 2) not null,
  source text not null, -- e.g. 'battlepass_day_31'
  status delivery_status not null default 'pending',
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  delivered_by uuid references profiles(id) -- null if the addon delivered it, set if an admin did it manually
);

alter table in_game_deliveries enable row level security;
-- No SELECT/INSERT/UPDATE policies here on purpose — see file header.

-- ------------------------------------------------------------
-- 5. payment_submissions: bundle a rank/battlepass onto a submission
-- ------------------------------------------------------------
alter table payment_submissions add column rank_purchased member_rank;
alter table payment_submissions add column battlepass_purchased boolean not null default false;
alter table payment_submissions add column discount_applied numeric(10, 2) not null default 0;

-- ------------------------------------------------------------
-- 6. submit_payment() — extended (signature changed, drop first)
-- ------------------------------------------------------------
drop function if exists public.submit_payment(numeric, text, text, uuid, uuid);

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

  if (p_period_id is null) = (p_side_goal_id is null) then
    raise exception 'Specify exactly one of a period or a side goal.';
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

  -- Reserve the discount credit now, not at approval time — otherwise
  -- the same balance could be applied to two pending submissions at
  -- once. Refunded automatically if this submission gets rejected
  -- (see admin_reject_payment below).
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
    user_id, period_id, side_goal_id, amount_claimed, gcash_ref_enc, screenshot_url, status,
    rank_purchased, battlepass_purchased, discount_applied
  ) values (
    auth.uid(), p_period_id, p_side_goal_id, p_amount, pgp_sym_encrypt(p_gcash_ref, v_key), p_screenshot_path, 'pending',
    p_rank_purchased, p_battlepass_purchased, p_discount_applied
  );
end;
$$;

grant execute on function public.submit_payment to authenticated;

-- ------------------------------------------------------------
-- 7. admin_approve_payment() / admin_reject_payment() — extended
--    (body-only changes, same signature, safe to just replace)
-- ------------------------------------------------------------
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
  v_new_rank_expiry timestamptz;
  v_active_cycle_id uuid;
  v_active_cycle_expiry timestamptz;
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

  -- Rank: extend from whichever is later, now or the current expiry.
  -- Renewing early never wastes remaining time; upgrading VIP->MVP
  -- keeps whatever time is left and just swaps the tier. If the
  -- current expiry has already passed, "later" is just now — a
  -- fresh 30 days, not a top-up on an already-lapsed subscription.
  if v_rank_purchased is not null then
    select rank_expires_at into v_new_rank_expiry from profiles where id = v_user_id;
    v_new_rank_expiry := greatest(now(), coalesce(v_new_rank_expiry, now())) + interval '30 days';
    update profiles set rank = v_rank_purchased, rank_expires_at = v_new_rank_expiry where id = v_user_id;
  end if;

  -- Legacy Pass: same extend-if-active-else-fresh logic, applied to
  -- battlepass_cycles instead of a column on profiles.
  if v_battlepass_purchased then
    select id, expires_at into v_active_cycle_id, v_active_cycle_expiry
    from battlepass_cycles
    where user_id = v_user_id and expires_at > now()
    order by expires_at desc limit 1;

    if v_active_cycle_id is not null then
      update battlepass_cycles set expires_at = v_active_cycle_expiry + interval '31 days' where id = v_active_cycle_id;
    else
      insert into battlepass_cycles (user_id, started_at, expires_at)
      values (v_user_id, now(), now() + interval '31 days');
    end if;
  end if;

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

create or replace function public.admin_reject_payment(p_submission_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_amount numeric;
  v_discount_applied numeric;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  update payment_submissions
  set status = 'rejected', rejection_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_submission_id and status = 'pending'
  returning user_id, amount_claimed, discount_applied into v_user_id, v_amount, v_discount_applied;

  if v_user_id is null then
    raise exception 'Payment submission not found or already reviewed.';
  end if;

  -- Give back whatever discount credit this submission had reserved —
  -- a rejected payment shouldn't cost the member their credit too.
  if v_discount_applied > 0 then
    update profiles set discount_credits = discount_credits + v_discount_applied where id = v_user_id;
  end if;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), v_user_id, 'payment_rejected', jsonb_build_object('submission_id', p_submission_id, 'reason', p_reason));

  insert into notifications (user_id, type, message, reference_id)
  values (
    v_user_id, 'payment_rejected',
    'Your ₱' || v_amount || ' payment was rejected: "' || p_reason || '"',
    p_submission_id
  );
end;
$$;

grant execute on function public.admin_reject_payment to authenticated;

-- ------------------------------------------------------------
-- 8. claim_battlepass_day() — the member-facing claim action
-- ------------------------------------------------------------
create or replace function public.claim_battlepass_day(p_day_number int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle record;
  v_elapsed_day int;
  v_reward record;
begin
  if p_day_number < 1 or p_day_number > 31 then
    raise exception 'Invalid day.';
  end if;

  select * into v_cycle
  from battlepass_cycles
  where user_id = auth.uid() and expires_at > now()
  order by expires_at desc
  limit 1;

  if v_cycle is null then
    raise exception 'You don''t have an active Legacy Pass.';
  end if;

  -- Day 1 is claimable immediately on purchase; a new day unlocks
  -- every 24h after that, capped at 31.
  v_elapsed_day := least(31, extract(day from now() - v_cycle.started_at)::int + 1);

  if p_day_number > v_elapsed_day then
    raise exception 'That day isn''t available to claim yet.';
  end if;

  if exists (select 1 from battlepass_claims where cycle_id = v_cycle.id and day_number = p_day_number) then
    raise exception 'You already claimed that day.';
  end if;

  select * into v_reward from battlepass_reward_schedule where day_number = p_day_number;

  insert into battlepass_claims (cycle_id, day_number, reward_type, reward_amount)
  values (v_cycle.id, p_day_number, v_reward.reward_type, v_reward.reward_amount);

  if v_reward.reward_type = 'discount' then
    update profiles set discount_credits = discount_credits + v_reward.reward_amount where id = auth.uid();
  elsif v_reward.reward_type = 'claimblocks' then
    insert into in_game_deliveries (user_id, in_game_name, reward_type, amount, source)
    select auth.uid(), p.in_game_name, 'claimblocks', v_reward.reward_amount, 'battlepass_day_' || p_day_number
    from profiles p
    where p.id = auth.uid();
  end if;
end;
$$;

grant execute on function public.claim_battlepass_day to authenticated;

-- ------------------------------------------------------------
-- 9. get_my_profile() — extended (return shape changed, drop first)
-- ------------------------------------------------------------
drop function if exists public.get_my_profile();

create or replace function public.get_my_profile()
returns table (
  in_game_name text,
  real_name text,
  discord_username text,
  gender member_gender,
  rank member_rank,
  rank_expires_at timestamptz,
  discount_credits numeric
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'profile_encryption_key';

  if v_key is null then
    raise exception 'Encryption key not found in Vault.';
  end if;

  return query
    select
      p.in_game_name,
      pgp_sym_decrypt(p.real_name_enc, v_key),
      p.discord_username,
      p.gender,
      p.rank,
      p.rank_expires_at,
      p.discount_credits
    from profiles p
    where p.id = auth.uid();
end;
$$;

grant execute on function public.get_my_profile to authenticated;

-- ------------------------------------------------------------
-- 10. Addon-facing pull endpoints — service_role ONLY
-- ------------------------------------------------------------
create or replace function public.addon_list_pending_deliveries()
returns table (id uuid, in_game_name text, reward_type text, amount numeric, source text)
language sql
security definer
stable
set search_path = public
as $$
  select id, in_game_name, reward_type, amount, source
  from in_game_deliveries
  where status = 'pending'
  order by created_at asc;
$$;

create or replace function public.addon_mark_delivered(p_delivery_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update in_game_deliveries
  set status = 'delivered', delivered_at = now()
  where id = p_delivery_id and status = 'pending';

  if not found then
    raise exception 'Delivery not found or already delivered.';
  end if;
end;
$$;

create or replace function public.addon_list_current_ranks()
returns table (in_game_name text, rank member_rank)
language sql
security definer
stable
set search_path = public
as $$
  select in_game_name, rank
  from profiles
  where status <> 'left';
$$;

-- Explicit REVOKE, not just "no GRANT" — same lesson as the audit's
-- generate_period_notifications() finding: make cron/service-role-only
-- intent visible and enforced, not dependent on default privileges.
revoke execute on function public.addon_list_pending_deliveries() from public, authenticated, anon;
revoke execute on function public.addon_mark_delivered(uuid) from public, authenticated, anon;
revoke execute on function public.addon_list_current_ranks() from public, authenticated, anon;
