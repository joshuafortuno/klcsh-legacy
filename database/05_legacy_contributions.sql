-- ============================================================
-- LEGACY CONTRIBUTIONS — real history from before this site existed
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query >
-- paste > Run. Needs 04_admin_dashboard.sql already run (uses
-- is_admin()).
--
-- These are REAL contributions, pulled from the original tracking
-- spreadsheet (May-August 2026) — not fake placeholder data. They
-- predate this website, so most of these contributors don't have
-- an account here, and even for the ones who do now, there's no
-- reliable way to match spreadsheet names to accounts
-- automatically. contributor_name is just the gamertag as it
-- appeared on the sheet — no user_id, on purpose.
--
-- This is a separate table from payment_submissions rather than
-- reusing it with a nullable user_id: payment_submissions models
-- the live proof-upload-and-approve workflow (a GCash reference,
-- a screenshot, a pending/approved/rejected status) — none of
-- that applies to history that already happened before the app
-- existed. Forcing these rows into that table would mean either
-- fabricating fake proof data or loosening constraints that exist
-- for good reason. This table is intentionally much simpler: just
-- a name, an amount, and a date.
-- ============================================================

create table legacy_contributions (
  id uuid primary key default gen_random_uuid(),
  contributor_name text not null,
  amount numeric(10, 2) not null check (amount > 0),
  contributed_on date not null,
  created_at timestamptz not null default now()
);

alter table legacy_contributions enable row level security;

create policy "legacy contributions are viewable by all logged-in users"
  on legacy_contributions for select
  to authenticated
  using (true);

-- Admin-editable in case of a transcription fix later (e.g. the
-- "Akispade1209" 485-vs-45 question flagged when this was first
-- imported into data.js).
create policy "admins can insert legacy contributions"
  on legacy_contributions for insert
  to authenticated
  with check (is_admin());

create policy "admins can update legacy contributions"
  on legacy_contributions for update
  to authenticated
  using (is_admin());

create policy "admins can delete legacy contributions"
  on legacy_contributions for delete
  to authenticated
  using (is_admin());

-- ------------------------------------------------------------
-- The historical data itself. Note: "Akispade1209" appears twice
-- with the same July amount (15) but very different August
-- amounts (45 vs 485) — copied straight from the source
-- spreadsheet as given. Worth double-checking against the
-- original in case 485 was meant to be 45 (or it's two different
-- people who happened to share a gamertag).
-- ------------------------------------------------------------
insert into legacy_contributions (contributor_name, amount, contributed_on) values
  ('Cianxcx143', 46, '2026-08-25'),
  ('SableWave8829', 45, '2026-08-25'),
  ('cheesecakez2378', 235, '2026-08-25'),
  ('GsusFries28', 45, '2026-08-25'),
  ('BACKBURNER6367', 45, '2026-08-25'),
  ('LilyClouds', 35, '2026-08-25'),
  ('Vanzv1554', 73, '2026-08-25'),
  ('nathan70383', 45, '2026-08-25'),
  ('Akispade1209', 45, '2026-08-25'),
  ('Lovee Lady6017', 45, '2026-08-25'),
  ('Akispade1209', 485, '2026-08-25'),
  ('Yroma21', 85, '2026-08-25'),
  ('Damz0209', 65, '2026-07-25'),
  ('Ponkan Juice', 15, '2026-07-25'),
  ('Cianxcx143', 15, '2026-07-25'),
  ('SableWave8829', 15, '2026-07-25'),
  ('cheesecakez2378', 15, '2026-07-25'),
  ('GsusFries28', 15, '2026-07-25'),
  ('BACKBURNER6367', 15, '2026-07-25'),
  ('LilyClouds', 15, '2026-07-25'),
  ('Vanzv1554', 15, '2026-07-25'),
  ('nathan70383', 15, '2026-07-25'),
  ('Akispade1209', 15, '2026-07-25'),
  ('Lovee Lady6017', 15, '2026-07-25'),
  ('Akispade1209', 15, '2026-07-25'),
  ('Yroma21', 15, '2026-07-25'),
  ('SilentBeast8332', 75, '2026-06-25'),
  ('taki', 25, '2026-06-25'),
  ('Lei for 3, whii!', 100, '2026-06-25'),
  ('Phamiiii', 50, '2026-06-25'),
  ('TORCHY2746', 80, '2026-06-25'),
  ('kDee024k', 25, '2026-06-25'),
  ('Henkz47', 25, '2026-06-25'),
  ('Lily Luxanna', 25, '2026-06-25'),
  ('Ramenvk', 120, '2026-06-25'),
  ('ALTROSON', 80, '2026-06-25'),
  ('DEVONE8', 80, '2026-06-25'),
  ('Seigie', 45, '2026-06-25'),
  ('KerTz2008', 70, '2026-06-25'),
  ('MrBuilder7372', 25, '2026-06-25'),
  ('Damz0209', 75, '2026-06-25'),
  ('LynLin', 25, '2026-06-25'),
  ('BlanK0630', 75, '2026-06-25'),
  ('Choccimysm', 30, '2026-06-25'),
  ('SableWave8829', 50, '2026-06-25'),
  ('cheesecakez2378', 30, '2026-06-25'),
  ('Scrofa7518', 25, '2026-06-25'),
  ('GsusFries28', 25, '2026-06-25'),
  ('BACKBURNER6367', 25, '2026-06-25'),
  ('xorainee', 25, '2026-06-25'),
  ('Unstoppablepuff', 25, '2026-06-25'),
  ('Backheim', 30, '2026-06-25'),
  ('SilentBeast8332', 80, '2026-05-25'),
  ('FiLTer1016273', 80, '2026-05-25'),
  ('Kingkongkongkon', 80, '2026-05-25'),
  ('taki', 100, '2026-05-25'),
  ('Rn_Barbielat', 80, '2026-05-25'),
  ('DaverJohn22', 80, '2026-05-25'),
  ('ramram rys', 80, '2026-05-25'),
  ('Lei for 3, whii!', 80, '2026-05-25'),
  ('Phamiiii', 100, '2026-05-25'),
  ('TORCHY2746', 80, '2026-05-25'),
  ('kDee024k', 80, '2026-05-25'),
  ('Henkz47', 80, '2026-05-25'),
  ('Lily Luxanna', 80, '2026-05-25'),
  ('Ramenvk', 80, '2026-05-25'),
  ('MrBuilder7372', 80, '2026-05-25');
