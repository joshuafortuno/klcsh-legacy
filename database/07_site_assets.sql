-- ============================================================
-- SITE ASSETS — public images the admin uploads (starting with
-- the GCash QR code)
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query >
-- paste > Run. Needs 04_admin_dashboard.sql already run (uses
-- is_admin()).
--
-- Unlike payment-screenshots, this bucket is PUBLIC — a QR code
-- isn't sensitive, it's meant to be seen by anyone paying, and a
-- public bucket means the payment page can just use a plain
-- <img src="..."> instead of generating a signed URL on every
-- load. Only admins can upload/replace/delete what's in it.
--
-- Still needs its own SELECT policy despite being "public": the
-- public flag only affects the special public-URL read endpoint
-- (what <img src> hits). Uploading — especially with upsert:true,
-- which has to check whether the file already exists — goes
-- through the normal RLS-protected path, so without a SELECT
-- policy for `authenticated` here, the upload itself fails with a
-- generic "row-level security policy" error that looks like an
-- insert problem but isn't.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true)
on conflict (id) do nothing;

create policy "site assets are viewable by all logged-in users"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'site-assets');

create policy "admins can upload site assets"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'site-assets'
    and is_admin()
  );

create policy "admins can update site assets"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'site-assets'
    and is_admin()
  );

create policy "admins can delete site assets"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'site-assets'
    and is_admin()
  );
