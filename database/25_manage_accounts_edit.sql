-- ============================================================
-- MANAGE ACCOUNTS EDIT — admin-scoped profile editing, plus direct
-- rank/Legacy Pass overrides
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste
-- > Run. Needs 24_rank_upgrade_logic.sql already run.
--
-- What this adds:
--   1. admin_list_profiles() extended to also return rank,
--      rank_expires_at, and the member's active Legacy Pass expiry
--      (if any) — needed so the new edit form can show what a
--      member currently has before changing it.
--   2. admin_update_member_profile() — an admin-scoped version of
--      the self-service profile update (settings.js), letting an
--      admin fix another member's in-game name / real name /
--      Discord username. Same duplicate-name/Discord friendly
--      errors as create_profile() already has.
--   3. admin_set_member_rank() — a direct override, not a simulated
--      purchase: sets a member's rank straight to a chosen tier and
--      number of days remaining, bypassing the upgrade/downgrade
--      rules from apply_shop_purchase() entirely (those exist to
--      stop members gaming a purchase, not to constrain an admin
--      correcting the record). 0 days (or rank 'none') clears it.
--   4. admin_set_member_battlepass() — a plain on/off override. A
--      Legacy Pass is always exactly 31 days when active, so unlike
--      rank there's no "how many days" to ask for: turning it on
--      always (re)starts a fresh 31-day cycle at day 1, replacing
--      whatever active cycle existed rather than stacking onto it
--      (sidestepping the same "unreachable days" issue
--      24_rank_upgrade_logic.sql fixed for the purchase flow, by
--      construction — there's never more than one cycle to begin
--      with). Turning it off just removes the active cycle.
--   All three write actions log to status_audit_log, same
--   accountability trail every other sensitive admin action gets.
-- ============================================================

drop function if exists public.admin_list_profiles();

create or replace function public.admin_list_profiles()
returns table (
  id uuid,
  in_game_name text,
  real_name text,
  discord_username text,
  gender member_gender,
  role member_role,
  status member_status,
  left_at timestamptz,
  created_at timestamptz,
  rank member_rank,
  rank_expires_at timestamptz,
  battlepass_expires_at timestamptz
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
      p.id, p.in_game_name, pgp_sym_decrypt(p.real_name_enc, v_key),
      p.discord_username, p.gender, p.role, p.status, p.left_at, p.created_at,
      p.rank, p.rank_expires_at,
      (
        select bc.expires_at from battlepass_cycles bc
        where bc.user_id = p.id and bc.expires_at > now()
        order by bc.expires_at desc
        limit 1
      )
    from profiles p
    order by p.in_game_name;
end;
$$;

grant execute on function public.admin_list_profiles to authenticated;

create or replace function public.admin_update_member_profile(
  p_user_id uuid,
  p_in_game_name text,
  p_real_name text,
  p_discord_username text
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
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'Member not found.';
  end if;

  if p_in_game_name is null or trim(p_in_game_name) = '' then
    raise exception 'In-game name can''t be empty.';
  end if;
  if p_real_name is null or trim(p_real_name) = '' then
    raise exception 'Real name can''t be empty.';
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'profile_encryption_key';

  if v_key is null then
    raise exception 'Encryption key not found in Vault.';
  end if;

  update profiles
  set in_game_name = p_in_game_name,
      discord_username = p_discord_username,
      real_name_enc = pgp_sym_encrypt(p_real_name, v_key),
      real_name_hash = md5(lower(trim(p_real_name)))
  where id = p_user_id;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), p_user_id, 'profile_manually_edited', jsonb_build_object(
    'in_game_name', p_in_game_name, 'discord_username', p_discord_username
  ));
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

grant execute on function public.admin_update_member_profile to authenticated;

create or replace function public.admin_set_member_rank(
  p_user_id uuid,
  p_rank member_rank,
  p_days int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_rank member_rank;
  v_new_expiry timestamptz;
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'Member not found.';
  end if;

  if p_rank is null or p_rank = 'none' or p_days is null or p_days <= 0 then
    v_new_rank := 'none';
    v_new_expiry := null;
  else
    v_new_rank := p_rank;
    v_new_expiry := now() + make_interval(days => p_days);
  end if;

  update profiles set rank = v_new_rank, rank_expires_at = v_new_expiry where id = p_user_id;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), p_user_id, 'rank_manually_set', jsonb_build_object('rank', v_new_rank, 'days', p_days));
end;
$$;

grant execute on function public.admin_set_member_rank to authenticated;

create or replace function public.admin_set_member_battlepass(
  p_user_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'Member not found.';
  end if;

  delete from battlepass_cycles where user_id = p_user_id and expires_at > now();

  if p_active then
    insert into battlepass_cycles (user_id, started_at, expires_at)
    values (p_user_id, now(), now() + interval '31 days');
  end if;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), p_user_id, 'battlepass_manually_set', jsonb_build_object('active', p_active));
end;
$$;

grant execute on function public.admin_set_member_battlepass to authenticated;

-- One atomic entry point for the edit form's "Save changes" — wraps
-- the four functions above (profile fields, rank, battlepass) plus
-- the existing admin_set_role()/admin_set_status() in a single
-- transaction, so a failure partway through (e.g. a duplicate
-- in-game name) rolls back everything else the same Save attempted
-- instead of leaving some fields changed and others not.
create or replace function public.admin_update_member(
  p_user_id uuid,
  p_in_game_name text,
  p_real_name text,
  p_discord_username text,
  p_role member_role,
  p_status member_status,
  p_rank member_rank,
  p_rank_days int,
  p_battlepass_active boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admin access required.';
  end if;

  perform admin_update_member_profile(p_user_id, p_in_game_name, p_real_name, p_discord_username);
  perform admin_set_role(p_user_id, p_role);
  perform admin_set_status(p_user_id, p_status);
  perform admin_set_member_rank(p_user_id, p_rank, p_rank_days);
  perform admin_set_member_battlepass(p_user_id, p_battlepass_active);
end;
$$;

grant execute on function public.admin_update_member to authenticated;
