-- ============================================================
-- PROFILE MANAGEMENT — gender field + self-service edit
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query >
-- paste > Run. Needs schema.sql and 02_profile_creation.sql to
-- have already been run (it reuses the same Vault secret).
--
-- What this adds:
--   1. A `gender` column — used only to pick which avatar icon
--      to show in the header (Steve-style, Alex-style, or the
--      plain outline for "other"/unset).
--   2. get_my_profile() — lets the profile page read back your
--      OWN row with real_name DECRYPTED, so the edit form can
--      show it. Only ever reads auth.uid()'s row.
--   3. update_real_name() — re-encrypts a new real name, same
--      pattern as create_profile().
--   4. A column-level lockdown on direct UPDATEs (see note
--      below) — this also fixes a gap in the existing RLS
--      policy, not just something needed for this feature.
--   5. create_profile() re-defined to also accept gender (it
--      predates that column) — see the note further down for
--      why registration doesn't call it directly anymore.
-- ============================================================

create type member_gender as enum ('male', 'female', 'other');

alter table profiles
  add column gender member_gender not null default 'other';

-- ------------------------------------------------------------
-- SECURITY FIX, found while building this:
-- The "users can update their own profile" policy in schema.sql
-- allows UPDATE on the whole row with no column restriction.
-- That means, as it stood, a signed-in member could call
-- supabase.from('profiles').update({ role: 'admin' }) on
-- themselves and RLS would allow it — the policy only checks
-- WHICH ROW (auth.uid() = id), not which COLUMNS. Restricting
-- the grant to just the columns members should ever touch
-- directly closes that off. real_name still can't be set this
-- way either — a plain UPDATE can't produce a validly encrypted
-- value, so it has to go through update_real_name() below.
-- ------------------------------------------------------------
revoke update on profiles from authenticated;
grant update (in_game_name, discord_username, gender) on profiles to authenticated;

-- ------------------------------------------------------------
-- Returns the CALLER's own profile, real_name decrypted.
-- Takes no id parameter on purpose — it always reads auth.uid(),
-- so there's no way to use it to read someone else's real name.
-- ------------------------------------------------------------
create or replace function public.get_my_profile()
returns table (
  in_game_name text,
  real_name text,
  discord_username text,
  gender member_gender
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
    raise exception 'Encryption key not found in Vault — set it up in Project Settings > Vault first.';
  end if;

  return query
    select
      p.in_game_name,
      pgp_sym_decrypt(p.real_name_enc, v_key),
      p.discord_username,
      p.gender
    from profiles p
    where p.id = auth.uid();
end;
$$;

grant execute on function public.get_my_profile to authenticated;

-- ------------------------------------------------------------
-- Re-encrypts and saves a new real name for the CALLER only
-- (auth.uid(), not a passed-in id — same reasoning as above).
-- ------------------------------------------------------------
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
  set real_name_enc = pgp_sym_encrypt(p_real_name, v_key)
  where id = auth.uid();
end;
$$;

grant execute on function public.update_real_name to authenticated;

-- ------------------------------------------------------------
-- create_profile() re-defined to also take gender — it predates
-- that column. We drop the old 3-argument version first so this
-- REPLACES it instead of creating a second, overloaded function
-- with the same name (which would make calls ambiguous).
--
-- Bigger note: this function only works when called with a real,
-- logged-in session — it uses auth.uid() to know whose row to
-- insert. If email confirmation is required (it is, on this
-- site), signUp() does NOT hand back a session; you're not
-- "logged in" until you confirm and then log in. So the frontend
-- no longer calls this immediately after signUp() — it's called
-- on first successful login instead (see auth-login.js), when a
-- session genuinely exists. Calling it too early is exactly what
-- produced the "null value in column id" error.
-- ------------------------------------------------------------
drop function if exists public.create_profile(text, text, text);

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
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'profile_encryption_key';

  if v_key is null then
    raise exception 'Encryption key not found in Vault — set it up in Project Settings > Vault first.';
  end if;

  insert into profiles (id, in_game_name, real_name_enc, discord_username, gender)
  values (
    auth.uid(),
    p_in_game_name,
    pgp_sym_encrypt(p_real_name, v_key),
    p_discord_username,
    p_gender
  );
end;
$$;

grant execute on function public.create_profile to authenticated;
