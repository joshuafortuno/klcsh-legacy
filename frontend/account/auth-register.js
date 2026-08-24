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

  Instead, we stash what they typed in localStorage and finish
  creating the profile on their first successful login (see
  auth-login.js), once a real session exists. If they confirm
  on a different device than the one they registered on, this
  stashed data won't be there — the Settings page (My Profile)
  can create the row from scratch in that case instead.
  --------------------------------------------------------
*/

const form = document.getElementById("register-form");
const errorEl = document.getElementById("form-error");
const submitBtn = document.getElementById("submit-btn");

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
  if (password.length < 8) {
    errorEl.textContent = "Password must be at least 8 characters.";
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
  });

  submitBtn.disabled = false;
  submitBtn.textContent = "Create account";

  if (signUpError) {
    errorEl.textContent = signUpError.message;
    return;
  }

  // No session yet (email confirmation required), so we can't call
  // create_profile() here — stash the fields for auth-login.js to
  // pick up on first successful login instead.
  localStorage.setItem("pendingProfile", JSON.stringify({
    in_game_name: inGameName,
    real_name: realName,
    discord_username: discordUsername || null,
  }));

  // Success — Supabase already sent a confirmation email.
  document.querySelector(".auth-card").innerHTML = `
    <h1>Check your email</h1>
    <p class="auth-sub">
      We sent a confirmation link to <strong>${email}</strong>.
      Click it, then come back and log in.
    </p>
    <a href="/login" class="btn-gold" style="display:block; text-align:center; text-decoration:none;">Go to login</a>
  `;
});
