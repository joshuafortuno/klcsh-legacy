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
