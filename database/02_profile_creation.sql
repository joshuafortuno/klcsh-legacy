-- ============================================================
-- PROFILE CREATION FUNCTION
-- ------------------------------------------------------------
-- Why this exists: real_name_enc needs to be encrypted, but we
-- never want the encryption KEY to exist in browser JavaScript
-- (anyone could open dev tools and read it). So instead of
-- encrypting in the frontend, the browser sends the plain text
-- to this function, which runs INSIDE Supabase, fetches the key
-- from Supabase Vault (a secrets manager, also inside Supabase),
-- encrypts it there, and stores only the encrypted result.
-- The key never leaves the database.
-- ============================================================

-- ONE-TIME MANUAL STEP (do this in the dashboard, not SQL):
-- Go to Project Settings > Vault > "Add new secret"
-- Name it exactly: profile_encryption_key
-- Value: any long random string (e.g. generate one at
-- https://1password.com/password-generator, 32+ characters)
-- Save it somewhere safe too — if you ever lose it, encrypted
-- real names become unrecoverable.

create or replace function public.create_profile(
  p_in_game_name text,
  p_real_name text,
  p_discord_username text default null
)
returns void
language plpgsql
security definer -- runs with elevated privileges, bypassing RLS,
                  -- specifically so it CAN insert on the caller's behalf
set search_path = public, extensions -- pgcrypto's functions (pgp_sym_encrypt)
                  -- live in the `extensions` schema on Supabase, not
                  -- `public` — without this, the function can't see them
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

  insert into profiles (id, in_game_name, real_name_enc, discord_username)
  values (
    auth.uid(),            -- the currently signed-in user, taken from their auth token
    p_in_game_name,
    pgp_sym_encrypt(p_real_name, v_key),
    p_discord_username
  );
end;
$$;

-- Lets any logged-in user CALL this function (they still can't
-- read the encryption key or bypass it — they can only run it,
-- and it only ever inserts a row for THEIR OWN id via auth.uid()).
grant execute on function public.create_profile to authenticated;
