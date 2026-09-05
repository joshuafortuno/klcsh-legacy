-- ============================================================
-- WHITELIST — admin-controlled in-game server whitelist toggle
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste
-- > Run. Needs 25_manage_accounts_edit.sql already run.
--
-- What this adds:
--   1. profiles.whitelisted — a plain boolean, default false.
--   2. admin_list_profiles() extended to also return it, so the new
--      admin Whitelist page can show each member's current state.
--   3. admin_set_member_whitelisted() — the toggle's write path,
--      same is_admin() + status_audit_log shape as every other
--      admin_set_member_*() function.
--   4. addon_list_current_ranks() extended to also return it — the
--      addon-bridge reads this alongside rank to write both
--      rank_tier and the whitelist add/remove commands into the
--      same generated .mcfunction file. Still service_role-only,
--      same as every other addon_* function.
-- ============================================================

alter table profiles add column whitelisted boolean not null default false;

-- ------------------------------------------------------------
-- 1. admin_list_profiles() — add whitelisted to the return shape
-- ------------------------------------------------------------
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
  battlepass_expires_at timestamptz,
  whitelisted boolean
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
      ),
      p.whitelisted
    from profiles p
    order by p.in_game_name;
end;
$$;

grant execute on function public.admin_list_profiles to authenticated;

-- ------------------------------------------------------------
-- 2. admin_set_member_whitelisted() — the toggle's write path
-- ------------------------------------------------------------
create or replace function public.admin_set_member_whitelisted(
  p_user_id uuid,
  p_whitelisted boolean
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

  update profiles set whitelisted = p_whitelisted where id = p_user_id;

  insert into status_audit_log (actor_id, target_user_id, action, details)
  values (auth.uid(), p_user_id, 'whitelist_manually_set', jsonb_build_object('whitelisted', p_whitelisted));
end;
$$;

grant execute on function public.admin_set_member_whitelisted to authenticated;

-- ------------------------------------------------------------
-- 3. addon_list_current_ranks() — add whitelisted to the return
--    shape the bridge reads every run
-- ------------------------------------------------------------
drop function if exists public.addon_list_current_ranks();

create or replace function public.addon_list_current_ranks()
returns table (in_game_name text, rank member_rank, whitelisted boolean)
language sql
security definer
stable
set search_path = public
as $$
  select in_game_name, rank, whitelisted
  from profiles
  where status <> 'left';
$$;

-- DROP resets privileges to default — re-apply the same
-- service_role-only restriction 11_shop_core.sql originally set.
revoke execute on function public.addon_list_current_ranks() from public, authenticated, anon;
