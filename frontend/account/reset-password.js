/*
  RESET-PASSWORD.JS
  --------------------------------------------------------
  Reached only via the link Supabase emails from
  resetPasswordForEmail() (see auth-login.js's forgot-password
  handler). Opening that link makes supabase-js establish a
  short-lived "recovery" session automatically — it parses the
  token straight out of the URL itself, no code needed here for
  that part. All this page has to do is:

    1. Check whether that session actually came through.
    2. If yes, let them set a new password via updateUser().
    3. If no (link already used, expired, or the page was opened
       directly without a link), show a dead-end message instead
       of a broken form.

  Deliberately does NOT use auth-guard.js's requireAuth() — a
  recovery session is a real session, so requireAuth() would
  actually let it through fine, but this page needs to work from
  the "not normally logged in" state that clicking an email link
  implies, and showing the invalid-link message on its own terms
  is clearer than however requireAuth() would redirect it.
  --------------------------------------------------------
*/

const resetForm = document.getElementById("reset-form");
const invalidNotice = document.getElementById("invalid-link-notice");
const doneNotice = document.getElementById("reset-done-notice");
const resetError = document.getElementById("reset-error");
const resetSubmitBtn = document.getElementById("reset-submit-btn");

(async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (session) {
    resetForm.hidden = false;
  } else {
    invalidNotice.hidden = false;
  }
})();

resetForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  resetError.textContent = "";

  const newPassword = document.getElementById("new-password").value;
  const confirmPassword = document.getElementById("confirm-password").value;

  if (newPassword.length < 8) {
    resetError.textContent = "Password must be at least 8 characters.";
    return;
  }
  if (newPassword !== confirmPassword) {
    resetError.textContent = "Passwords don't match.";
    return;
  }

  resetSubmitBtn.disabled = true;
  resetSubmitBtn.textContent = "Saving…";

  const { error } = await supabaseClient.auth.updateUser({ password: newPassword });

  if (error) {
    resetSubmitBtn.disabled = false;
    resetSubmitBtn.textContent = "Set new password";
    resetError.textContent = error.message;
    return;
  }

  resetForm.hidden = true;
  doneNotice.hidden = false;
});
