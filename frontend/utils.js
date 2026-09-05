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

// Temporary kill switch for the Legacy Pass (battlepass) feature —
// flip back to false to restore it. One flag, shared by every page
// that touches battlepass (pay.js's purchase checkbox, battlepass.js's
// claim page), so re-enabling it later is a single-line change
// instead of hunting down every place it's gated.
const BATTLEPASS_DISABLED = true;

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

/*
  Password strength — shared by every password-entry point
  (register, Settings > change password, reset-password). One
  definition so the live checklist and the submit-time error can
  never drift out of sync with each other.

  Deliberately does NOT restrict *which* special characters are
  allowed, beyond requiring at least one — passwords here only ever
  travel as a JSON field straight to Supabase Auth's API, never
  interpolated into SQL, HTML, or a shell command, so there's no
  injection surface to defend by narrowing the character set. Doing
  so would only shrink the keyspace a brute-force has to search.
*/
const PASSWORD_MAX_LENGTH = 72; // bcrypt (what Supabase Auth hashes with) ignores anything past this

const PASSWORD_RULES = [
  { key: "length", label: "At least 8 characters", test: (pw) => pw.length >= 8 },
  { key: "upper", label: "One uppercase letter", test: (pw) => /[A-Z]/.test(pw) },
  { key: "number", label: "One number", test: (pw) => /[0-9]/.test(pw) },
  { key: "special", label: "One special character", test: (pw) => /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~\\]/.test(pw) },
];

function passwordRuleResults(password) {
  return PASSWORD_RULES.map((rule) => ({ ...rule, passed: rule.test(password) }));
}

// Submit-time gate. The live checklist below already covers
// PASSWORD_RULES — this adds the two things that aren't a "did you
// type X" checklist item: an upper bound so a pathological paste
// doesn't get silently truncated by bcrypt without anyone knowing,
// and catching an accidental leading/trailing space from a
// copy-paste (never intentional, and easy to lose track of since
// the field is masked).
function passwordStrengthError(password) {
  if (password.trim() !== password) {
    return "Remove the leading or trailing space in your password.";
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password can't be longer than ${PASSWORD_MAX_LENGTH} characters.`;
  }
  const missing = passwordRuleResults(password).filter((r) => !r.passed).map((r) => r.label);
  if (missing.length > 0) {
    return "Password needs: " + missing.join(", ") + ".";
  }
  return null;
}

// Renders PASSWORD_RULES into checklistEl as a live-updating list —
// each <li> gets a "rule-passed" class toggled on/off as inputEl is
// typed into, using the exact same rule.test() the submit-time
// passwordStrengthError() checks, so the checklist never shows all
// green on something the submit handler would still reject.
function initPasswordChecklist(inputEl, checklistEl) {
  checklistEl.innerHTML = PASSWORD_RULES
    .map((rule) => `<li data-rule="${rule.key}">${escapeHtml(rule.label)}</li>`)
    .join("");

  const update = () => {
    const password = inputEl.value;
    PASSWORD_RULES.forEach((rule) => {
      checklistEl.querySelector(`[data-rule="${rule.key}"]`).classList.toggle("rule-passed", rule.test(password));
    });
  };

  inputEl.addEventListener("input", update);
  update();
}
