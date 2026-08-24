/*
  AUTH-LOGIN.JS
  --------------------------------------------------------
  Supabase actually lets a user "sign in" with correct
  credentials even before their email is verified — it just
  won't have confirmed their email. So the verification gate
  is something WE enforce: check `email_confirmed_at` right
  after login, and if it's empty, sign them back out and
  show the "check your email" message instead of letting
  them through.

  (Profile creation for a brand-new account happens in
  auth-guard.js's requireAuth(), not here — see the comment
  there for why.)
  --------------------------------------------------------
*/

const form = document.getElementById("login-form");
const errorEl = document.getElementById("form-error");
const submitBtn = document.getElementById("submit-btn");
const verifyNotice = document.getElementById("verify-notice");
const resendBtn = document.getElementById("resend-btn");

let pendingEmail = ""; // stored so the resend button knows who to resend to

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  verifyNotice.hidden = true;

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  submitBtn.disabled = true;
  submitBtn.textContent = "Logging in…";

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  submitBtn.disabled = false;
  submitBtn.textContent = "Log in";

  if (error) {
    errorEl.textContent = "Incorrect email or password.";
    return;
  }

  // Enforce the verification gate ourselves
  if (!data.user.email_confirmed_at) {
    pendingEmail = email;
    await supabaseClient.auth.signOut(); // don't leave them half-logged-in
    verifyNotice.hidden = false;
    return;
  }

  // Verified and logged in — go to the dashboard. (The homepage's
  // own requireAuth() call finishes creating the profile if
  // registration left one pending; see auth-guard.js.)
  window.location.href = "/";
});

resendBtn.addEventListener("click", async () => {
  resendBtn.disabled = true;
  resendBtn.textContent = "Sending…";

  const { error } = await supabaseClient.auth.resend({
    type: "signup",
    email: pendingEmail,
  });

  resendBtn.disabled = false;
  resendBtn.textContent = error ? "Try again" : "Sent! Check your inbox";
});
