/*
  UTILS.JS
  --------------------------------------------------------
  Shared helpers that were previously copy-pasted into 8+ files
  (money(), several near-identical date formatters) — any drift
  between copies meant the same value could display differently
  depending on which page you were on. One definition now, loaded
  on every page right after supabase-client.js.

  escapeHtml() is the important one: every list on this site builds
  its rows by interpolating data straight into an innerHTML template
  string. Several of those fields (in_game_name, real_name,
  discord_username, rejection reasons, notification messages) are
  free text someone typed — a member via Settings, an admin via a
  rejection prompt. Without escaping, a value like
  "<img src=x onerror=...>" set as an in-game name would execute as
  real HTML/JS for every single person who views a page rendering
  it, including admins. Run untrusted text through this before it
  goes anywhere near innerHTML, whether as element content or inside
  a quoted attribute (it escapes quotes too, so it's safe in both).
  --------------------------------------------------------
*/

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(n) {
  return `₱${Number(n).toLocaleString()}`;
}

// "2026-08-25T00:00:00Z" -> "Aug 25, 2026"
function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// "2026-08-25T00:00:00Z" -> "Aug 25 · 12:39 AM"
function formatDateTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// "2026-09-01" -> "September 2026" — periods are stored as the 1st
// of their month, this is just the human label for that.
function monthLabel(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
