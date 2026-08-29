/*
  SUPABASE-CLIENT.JS
  --------------------------------------------------------
  This is the ONE place your project URL and public key live.
  Every other page/script includes this file first, then uses
  the `supabaseClient` object it creates.

  IMPORTANT: replace the two placeholder values below with
  YOUR values from Supabase: Project Settings > API.

  Is it safe to put the anon key in frontend code? Yes — it's
  called "anon" (anonymous) on purpose. It can't do anything
  our Row Level Security policies don't allow. The one key
  that must NEVER go in frontend code is "service_role",
  which bypasses RLS entirely.
  --------------------------------------------------------
*/

const SUPABASE_URL = "https://vqincdkzeqzojvbhcukl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxaW5jZGt6ZXF6b2p2YmhjdWtsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1NjMzODUsImV4cCI6MjEwMzEzOTM4NX0.iEakamd2omXzoEu6N31xGfTuUN-VePC_hZ09jNqL_Aw";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/*
  A password-recovery link (see auth-login.js's resetPasswordForEmail
  call) is supposed to land on /reset-password, but the recovery token
  it carries is portable — an old link, a misconfigured Supabase "Site
  URL" fallback, or a stale bookmark can make the browser establish
  that session somewhere else entirely. Since a recovery session is a
  real session, requireAuth() on any other protected page would just
  accept it and let the visitor browse normally with their OLD
  password still active, silently skipping the "set a new password"
  step this link exists for — exactly the failure mode we want to
  close off. Supabase fires "PASSWORD_RECOVERY" the moment it parses
  that token, wherever that happens to be; catching it here (loaded on
  every page, before any page-specific script runs) means the visitor
  always ends up on the reset form regardless of which page the link
  actually opened.
*/
supabaseClient.auth.onAuthStateChange((event) => {
  const onResetPage =
    window.location.pathname.startsWith("/reset-password") ||
    window.location.pathname.startsWith("/account/reset-password");

  if (event === "PASSWORD_RECOVERY" && !onResetPage) {
    window.location.href = "/reset-password";
  }
});
