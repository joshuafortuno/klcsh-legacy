-- ============================================================
-- UNIQUENESS CONSTRAINTS — in-game name, Discord username, GCash
-- reference reuse, and a soft real-name collision warning
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query >
-- paste > Run. Needs schema.sql, 02_profile_creation.sql,
-- 03_profile_management.sql, and 06_payment_submissions.sql
-- already run.
--
-- BEFORE RUNNING: the two new unique indexes below will fail to
-- create if a duplicate already exists in your live data. Worth
-- checking first:
--   select lower(in_game_name), count(*) from profiles group by 1 having count(*) > 1;
--   select lower(discord_username), count(*) from profiles where discord_username is not null group by 1 having count(*) > 1;
-- If either returns rows, resolve them (ask the affected members,
-- or have an admin edit one via Manage Accounts) before running
-- this file.
--
-- What this adds, and why each one is scoped the way it is:
--
--   1. in_game_name: HARD unique (case-insensitive). Since the shop
--      feature, this is what the addon-bridge will use to target
--      real Minecraft accounts — two site accounts sharing one
--      in-game name could mean one member's purchased rank gets
--      applied to a different real player. Deliberately does NOT
--      check legacy_contributions — that table predates accounts
--      entirely and isn't bound to any profile, so several real
--      current members (who contributed before the site existed)
--      would otherwise get incorrectly blocked from registering
--      under the very name they already contributed under.
--
--   2. discord_username: HARD unique (case-insensitive), same
--      impersonation reasoning as in_game_name — safe to do this
--      one as a hard block because Discord usernames genuinely ARE
--      unique on Discord's own platform, so there's no legitimate
--      collision to false-positive on (unlike real names).
--
--   3. real_name: SOFT warning only, not blocked. Real names
--      genuinely can collide between two unrelated real people —
--      hard-blocking would lock out the second legitimate person.
--      real_name is encrypted (real_name_enc), and PGP symmetric
--      encryption produces different ciphertext every time even for
--      identical plaintext, so a plain unique constraint on that
--      column would silently never catch anything. real_name_hash
--      (a plain md5 of the lowercased/trimmed name — not meant to
--      resist attack, just a comparable stand-in for encrypted data)
--      exists purely so is_real_name_taken() can check for a
--      collision without decrypting every other member's name to do
--      it. No constraint on this column — it's a lookup aid, not an
--      enforcement mechanism.
--
--   4. GCash reference numbers: HARD unique, but only among
--      pending/approved submissions — a real GCash transaction ref
--      is only ever issued once, so the same ref appearing twice is
--      a strong signal someone is replaying an old proof screenshot
--      to fraudulently claim a second payment without sending money
--      again. Scoped to exclude rejected submissions on purpose: if
--      a submission gets rejected for something fixable (wrong
--      amount typed, wrong target selected), the member needs to be
--      able to resubmit with the SAME real reference number. Same
--      encrypted-column wrinkle as real_name — gcash_ref_hash is
--      the lookup aid, backfilled here for every existing row.
-- ============================================================

-- ------------------------------------------------------------
-- 1 & 2. in_game_name / discord_username — hard unique
-- ------------------------------------------------------------
create unique index profiles_in_game_name_unique on profiles (lower(in_game_name));
create unique index profiles_discord_username_unique on profiles (lower(discord_username));

-- ------------------------------------------------------------
-- 3. real_name — soft warning via a hash lookup, not a constraint
-- ------------------------------------------------------------
alter table profiles add column real_name_hash text;

-- Backfill existing rows so the check works retroactively, not just
-- for names saved after this migration runs.
do $$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'profile_encryption_key';
  if v_key is not null then
    update profiles
    set real_name_hash = md5(lower(trim(pgp_sym_decrypt(real_name_enc, v_key))))
    where real_name_hash is null and real_name_enc is not null;
  end if;
end $$;

create or replace function public.create_profile(
  p_in_game_name text,
  p_real_name text,
  p_discord_username text default null,
  p_gender member_gender default 'other'
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_constraint text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'profile_encryption_key';

  if v_key is null then
    raise exception 'Encryption key not found in Vault — set it up in Project Settings > Vault first.';
  end if;

  insert into profiles (id, in_game_name, real_name_enc, real_name_hash, discord_username, gender)
  values (
    auth.uid(),
    p_in_game_name,
    pgp_sym_encrypt(p_real_name, v_key),
    md5(lower(trim(p_real_name))),
    p_discord_username,
    p_gender
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'profiles_in_game_name_unique' then
      raise exception 'That in-game name is already taken.';
    elsif v_constraint = 'profiles_discord_username_unique' then
      raise exception 'That Discord username is already taken.';
    else
      raise exception 'That value is already taken.';
    end if;
end;
$$;

grant execute on function public.create_profile to authenticated;

create or replace function public.update_real_name(p_real_name text)
returns void
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
    raise exception 'Encryption key not found in Vault — set it up in Project Settings > Vault first.';
  end if;

  update profiles
  set real_name_enc = pgp_sym_encrypt(p_real_name, v_key),
      real_name_hash = md5(lower(trim(p_real_name)))
  where id = auth.uid();
end;
$$;

grant execute on function public.update_real_name to authenticated;

-- Live "heads up, someone else already has this name" check — never
-- blocks anything, just informs. Excludes the caller's own row so
-- re-saving your own unchanged name never warns about yourself.
create or replace function public.is_real_name_taken(p_real_name text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where real_name_hash = md5(lower(trim(p_real_name)))
      and id <> auth.uid()
  );
$$;

grant execute on function public.is_real_name_taken to authenticated;

-- ------------------------------------------------------------
-- 4. GCash reference numbers — hard unique among pending/approved
-- ------------------------------------------------------------
alter table payment_submissions add column gcash_ref_hash text;

do $$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'profile_encryption_key';
  if v_key is not null then
    update payment_submissions
    set gcash_ref_hash = md5(lower(trim(pgp_sym_decrypt(gcash_ref_enc, v_key))))
    where gcash_ref_hash is null;
  end if;
end $$;

create unique index payment_submissions_gcash_ref_unique
  on payment_submissions (gcash_ref_hash)
  where status in ('pending', 'approved');

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
