-- ============================================================
-- KLCSH LEGACY — DATABASE SCHEMA
-- ------------------------------------------------------------
-- Run this in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Supabase already gives you `auth.users` (handles email,
-- password hashing, email verification tokens) — we don't
-- rebuild any of that. `profiles` just extends it with the
-- app-specific fields we need.
-- ============================================================

-- pgcrypto gives us functions to encrypt/decrypt specific
-- sensitive columns (real name, GCash reference numbers).
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- ENUMS
-- Restricting these to a fixed list of values (instead of
-- a plain text column) stops typos like 'Aktive' or 'admn'
-- from ever reaching the database.
-- ------------------------------------------------------------
create type member_role as enum ('member', 'admin');
create type member_status as enum ('active', 'inactive', 'left');
create type leave_request_status as enum ('pending', 'approved', 'denied');
create type period_status as enum ('open', 'finalized');
create type payment_status as enum ('pending', 'approved', 'rejected');

-- ------------------------------------------------------------
-- PROFILES
-- One row per member, linked 1-to-1 with Supabase's auth.users.
-- ------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,

  in_game_name text not null,

  -- Encrypted sensitive fields. We store them as `bytea`
  -- (encrypted bytes) rather than plain `text`, so even
  -- someone with raw database access can't read them without
  -- the encryption key (kept outside the database, in your
  -- app's server-side environment variables — never in code).
  real_name_enc bytea,
  discord_username text,

  role member_role not null default 'member',
  status member_status not null default 'active',

  -- set the moment status becomes 'left' — used to compute
  -- the 15-day countdown to soft-delete
  left_at timestamptz,

  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- LEAVE REQUESTS
-- A member's self-service "I want to leave" request.
-- Doesn't change status by itself — an admin reviews it.
-- ------------------------------------------------------------
create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  status leave_request_status not null default 'pending',
  requested_at timestamptz not null default now(),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz
);

-- ------------------------------------------------------------
-- PERIODS
-- One row per month. Starts 'open', locked to 'finalized'
-- once the admin closes the books for that month.
-- ------------------------------------------------------------
create table periods (
  id uuid primary key default gen_random_uuid(),
  month date not null unique, -- always the 1st of the month, e.g. 2026-09-01
  status period_status not null default 'open',

  total_expenses numeric(10, 2) not null default 0,
  active_member_count int,          -- snapshot taken at finalize time
  amount_due_per_member numeric(10, 2),

  surplus_carried_in numeric(10, 2) not null default 0,
  surplus_carried_out numeric(10, 2),

  finalized_at timestamptz,
  finalized_by uuid references profiles(id),

  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- EXPENSES
-- Every cost logged against a period. This is what powers
-- the itemized transparency breakdown.
-- ------------------------------------------------------------
create table expenses (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references periods(id) on delete cascade,

  category text not null,      -- e.g. 'hosting', 'plugin', 'domain'
  description text,
  amount numeric(10, 2) not null check (amount > 0),
  receipt_url text,             -- path in Supabase Storage, not a public URL

  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- PAYMENT SUBMISSIONS
-- A member's claimed GCash payment, pending admin review.
-- ------------------------------------------------------------
create table payment_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  period_id uuid not null references periods(id) on delete cascade,

  amount_claimed numeric(10, 2) not null check (amount_claimed > 0),
  gcash_ref_enc bytea not null,   -- encrypted, same reasoning as real_name_enc
  screenshot_url text not null,   -- private Supabase Storage path

  status payment_status not null default 'pending',
  rejection_reason text,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,

  submitted_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- STATUS AUDIT LOG
-- Every admin action that changes something sensitive gets
-- recorded here — protects you if a decision is ever questioned.
-- ------------------------------------------------------------
create table status_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),        -- who made the change
  target_user_id uuid references profiles(id),  -- who it affected (nullable)
  action text not null,                          -- e.g. 'status_change', 'expense_edit'
  details jsonb,                                  -- flexible: {"from": "active", "to": "left"}
  created_at timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ------------------------------------------------------------
-- This is the part that actually enforces "a member can only
-- see their own payments, not everyone else's." Without RLS
-- enabled, anyone with your public API key could query any
-- row. Supabase requires you to turn this on table by table.
-- ============================================================

alter table profiles enable row level security;
alter table leave_requests enable row level security;
alter table periods enable row level security;
alter table expenses enable row level security;
alter table payment_submissions enable row level security;
alter table status_audit_log enable row level security;

-- --- profiles ---
-- Everyone logged in can see everyone's basic profile (needed
-- for e.g. showing names in admin tools), but real_name_enc
-- and gcash-related data are only ever decrypted server-side
-- for the profile owner or an admin — RLS on the table row is
-- the first gate, decryption logic is the second.
create policy "profiles are viewable by all logged-in users"
  on profiles for select
  to authenticated
  using (true);

create policy "users can update their own profile"
  on profiles for update
  to authenticated
  using (auth.uid() = id);

-- --- leave_requests ---
create policy "users can view their own leave requests"
  on leave_requests for select
  to authenticated
  using (auth.uid() = user_id);

create policy "users can create their own leave request"
  on leave_requests for insert
  to authenticated
  with check (auth.uid() = user_id);

-- --- periods & expenses ---
-- Transparency = everyone can read these. Only admins write.
create policy "periods are viewable by all logged-in users"
  on periods for select
  to authenticated
  using (true);

create policy "expenses are viewable by all logged-in users"
  on expenses for select
  to authenticated
  using (true);

-- --- payment_submissions ---
-- The important one: a member sees ONLY their own submissions.
create policy "users can view their own payment submissions"
  on payment_submissions for select
  to authenticated
  using (auth.uid() = user_id);

create policy "users can create their own payment submission"
  on payment_submissions for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Note: admin-only policies (viewing ALL payment submissions,
-- writing to periods/expenses, approving leave requests) get
-- added once we set up the admin role check — that's a small
-- follow-up step once you're ready to wire up the admin panel.
