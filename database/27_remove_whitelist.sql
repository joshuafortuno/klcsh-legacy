-- ============================================================
-- REMOVE WHITELIST — reverts 26_whitelist.sql
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste
-- > Run. Needs 26_whitelist.sql already run (harmless either way —
-- every drop below uses IF EXISTS).
--
-- The whitelist feature relied on Bedrock having an in-game
-- `/whitelist add`/`/whitelist remove` command — it doesn't (Bedrock
-- manages its allowlist via a file the server reads directly, not a
-- slash command), so the feature never actually worked and is being
-- removed rather than reworked. This undoes 26_whitelist.sql exactly:
--   1. Drops admin_set_member_whitelisted().
--   2. Reverts admin_list_profiles() and addon_list_current_ranks()
--      back to their pre-26 return shapes (both were only ever
--      extended to carry `whitelisted` through, nothing else in
--      their behavior changed).
--   3. Drops profiles.whitelisted.
-- ============================================================

drop function if exists public.admin_set_member_whitelisted(uuid, boolean);

-- ------------------------------------------------------------
-- 1. admin_list_profiles() — back to its 25_manage_accounts_edit.sql
--    shape, minus whitelisted
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

-- ------------------------------------------------------------
-- 2. addon_list_current_ranks() — back to its 11_shop_core.sql
--    shape, minus whitelisted
-- ------------------------------------------------------------
drop function if exists public.addon_list_current_ranks();

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

revoke execute on function public.addon_list_current_ranks() from public, authenticated, anon;

-- ------------------------------------------------------------
-- 3. Drop the column itself
-- ------------------------------------------------------------
alter table profiles drop column if exists whitelisted;
