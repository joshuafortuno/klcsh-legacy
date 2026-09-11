/*
  AUTH-REGISTER.JS
  --------------------------------------------------------
  supabaseClient.auth.signUp() creates the login (email +
  password) — entirely handled by Supabase, we never touch or
  store the password ourselves.

  It does NOT create the profiles row here. We used to call
  create_profile() immediately after signUp(), but that's
  broken: this site requires email confirmation, and signUp()
  does not hand back a live session until the user has actually
  confirmed and logged in — so create_profile()'s auth.uid()
  had nothing to return, and the insert failed with a null id.

  Instead, what they typed goes through as signUp()'s own
  `options.data` — Supabase stores that as metadata on the
  auth.users row itself, not in localStorage, so it's available
  from whichever device/session first confirms the account, not
  only the one they registered on (localStorage doesn't follow
  them across devices; this does). auth-guard.js's requireAuth()
  picks it up and finishes creating the profile on the first
  page load after a real session exists, however that session
  came to be. If that metadata is ever missing for some reason,
  the Settings page (My Profile) can still create the row from
  scratch as a fallback.
  --------------------------------------------------------
*/

const form = document.getElementById("register-form");
const errorEl = document.getElementById("form-error");
const submitBtn = document.getElementById("submit-btn");

initPasswordChecklist(document.getElementById("password"), document.getElementById("password-checklist"));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const inGameName = document.getElementById("in-game-name").value.trim();
  const realName = document.getElementById("real-name").value.trim();
  const discordUsername = document.getElementById("discord-username").value.trim();
  const consented = document.getElementById("consent").checked;

  // basic validation before we even hit the network
  if (!email || !password || !inGameName || !realName) {
    errorEl.textContent = "Please fill in all required fields.";
    return;
  }
  const passwordProblem = passwordStrengthError(password);
  if (passwordProblem) {
    errorEl.textContent = passwordProblem;
    return;
  }
  if (!consented) {
    errorEl.textContent = "Please confirm you understand how your info is used.";
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Creating account…";

  const { error: signUpError } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        in_game_name: inGameName,
        real_name: realName,
        discord_username: discordUsername || null,
      },
    },
  });

  submitBtn.disabled = false;
  submitBtn.textContent = "Create account";

  if (signUpError) {
    errorEl.textContent = signUpError.message;
    return;
  }

  // No session yet (email confirmation required), so we can't call
  // create_profile() here — auth-guard.js's requireAuth() picks up
  // the metadata above and finishes creating the profile on first
  // page load after a real session exists, whichever device that
  // ends up being.

  // Success — Supabase already sent a confirmation email.
  document.querySelector(".auth-card").innerHTML = `
    <h1>Check your email</h1>
    <p class="auth-sub">
      We sent a confirmation link to <strong>${escapeHtml(email)}</strong>.
      Click it, then come back and log in.
    </p>
    <a href="/login" class="btn-gold" style="display:block; text-align:center; text-decoration:none;">Go to login</a>
  `;
});
