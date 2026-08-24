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

/*
  FORGOT PASSWORD
  --------------------------------------------------------
  Swaps #login-form out for #forgot-form in place (same card, no
  separate page) so this stays a single step for the user. The
  actual "set a new password" step happens on a different page —
  /reset-password — which the emailed link points at; Supabase
  itself handles proving the link is genuine (it establishes a
  short-lived recovery session when that link is opened), this
  page only has to ask for the email and trigger the send.
*/
const forgotLink = document.getElementById("forgot-password-link");
const loginSwitchWrap = document.getElementById("login-switch-wrap");
const backToLoginLink = document.getElementById("back-to-login-link");
const backToLoginWrap = document.getElementById("back-to-login-wrap");
const forgotForm = document.getElementById("forgot-form");
const forgotError = document.getElementById("forgot-error");
const forgotSuccess = document.getElementById("forgot-success");
const forgotSubmitBtn = document.getElementById("forgot-submit-btn");

forgotLink.addEventListener("click", (e) => {
  e.preventDefault();
  form.hidden = true;
  verifyNotice.hidden = true;
  loginSwitchWrap.hidden = true;
  forgotForm.hidden = false;
  backToLoginWrap.hidden = false;
});

backToLoginLink.addEventListener("click", (e) => {
  e.preventDefault();
  forgotForm.hidden = true;
  backToLoginWrap.hidden = true;
  form.hidden = false;
  loginSwitchWrap.hidden = false;
});

forgotForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  forgotError.textContent = "";
  forgotSuccess.textContent = "";

  const email = document.getElementById("forgot-email").value.trim();

  forgotSubmitBtn.disabled = true;
  forgotSubmitBtn.textContent = "Sending…";

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + "/reset-password",
  });

  forgotSubmitBtn.disabled = false;
  forgotSubmitBtn.textContent = "Send reset link";

  // Same message either way — confirming or denying whether an
  // email is registered would let someone probe for valid accounts.
  forgotSuccess.textContent = "If that email has an account, a reset link is on its way. Check your inbox.";
  if (error) console.error("resetPasswordForEmail:", error.message);
});
