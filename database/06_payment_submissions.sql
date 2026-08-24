-- ============================================================
-- PAYMENT SUBMISSIONS — the member-facing "chip in" flow
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query >
-- paste > Run. Needs 04_admin_dashboard.sql already run (uses
-- is_admin()).
--
-- What this adds:
--   1. site_settings — a single-row table holding your GCash
--      name/number (and optionally a QR image URL), shown to
--      members on the payment page. Admin-editable from Manage
--      Contributions.
--   2. A private Storage bucket for payment screenshots, with
--      policies so a member can only upload/read their own, and
--      only admins can read everyone's — this is what finally
--      makes the "Proof" link on Notifications work.
--   3. submit_payment() — encrypts the GCash reference the same
--      way real_name is encrypted, and is the ONLY way a
--      submission gets created (see the security fix below).
--   4. A security fix: the existing "users can create their own
--      payment submission" policy allowed a direct INSERT with no
--      column restrictions — meaning a member could currently
--      call the API directly and insert their own submission with
--      status already set to 'approved', self-approving a payment
--      they never made. Direct INSERT is revoked; submit_payment()
--      always sets status = 'pending' itself, no matter what.
-- ============================================================

-- ------------------------------------------------------------
-- SITE SETTINGS
-- Single row, enforced by the id = 1 check. Seeded with nulls —
-- the payment page shows "not set up yet" until an admin fills
-- these in.
-- ------------------------------------------------------------
create table site_settings (
  id int primary key default 1,
  gcash_name text,
  gcash_number text,
  gcash_qr_url text,
  updated_at timestamptz not null default now(),
  constraint site_settings_singleton check (id = 1)
);

insert into site_settings (id) values (1);

alter table site_settings enable row level security;

create policy "site settings are viewable by all logged-in users"
  on site_settings for select
  to authenticated
  using (true);

create policy "admins can update site settings"
  on site_settings for update
  to authenticated
  using (is_admin());

-- ------------------------------------------------------------
-- STORAGE: private bucket for payment screenshots
-- Objects are stored under "{user_id}/{filename}" — the policies
-- below check that path prefix to decide who can read/write what.
-- storage.objects already has RLS enabled by Supabase itself, so
-- there's no "alter table ... enable row level security" needed
-- here, just the policies.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('payment-screenshots', 'payment-screenshots', false)
on conflict (id) do nothing;

create policy "members can upload their own payment screenshots"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "members can view their own payment screenshots"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'payment-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "admins can view all payment screenshots"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'payment-screenshots'
    and is_admin()
  );

-- ------------------------------------------------------------
-- SECURITY FIX + submit_payment()
-- ------------------------------------------------------------
drop policy if exists "users can create their own payment submission" on payment_submissions;
revoke insert on payment_submissions from authenticated;

-- p_screenshot_path is the Storage object path from the upload
-- step above (e.g. "‹user_id›/1735000000-proof.jpg"), not a URL —
-- the frontend turns it into a signed URL on demand when an admin
-- wants to view it, since the bucket is private.
create or replace function public.submit_payment(
  p_amount numeric,
  p_gcash_ref text,
  p_screenshot_path text,
  p_period_id uuid default null,
  p_side_goal_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than 0.';
  end if;

  if (p_period_id is null) = (p_side_goal_id is null) then
    raise exception 'Specify exactly one of a period or a side goal.';
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'profile_encryption_key';

  if v_key is null then
    raise exception 'Encryption key not found in Vault.';
  end if;

  insert into payment_submissions (
    user_id, period_id, side_goal_id, amount_claimed, gcash_ref_enc, screenshot_url, status
  ) values (
    auth.uid(), p_period_id, p_side_goal_id, p_amount, pgp_sym_encrypt(p_gcash_ref, v_key), p_screenshot_path, 'pending'
  );
end;
$$;

grant execute on function public.submit_payment to authenticated;
