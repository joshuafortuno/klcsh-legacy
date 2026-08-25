/*
  SETTINGS.JS
  --------------------------------------------------------
  Three independent forms on this page:

  - Profile: shows a read-only view of your current values by
    default, with an "Edit" button that swaps in the editable
    form (pre-filled, since loadProfile() already populated the
    inputs). Saving swaps back to the view, now showing what you
    just saved. If there's no profile yet at all (hasProfile
    false — see below), there's nothing to view, so it skips
    straight to edit mode instead of showing an empty view.

    Saving itself: normally, in_game_name / discord_username /
    gender go through a plain UPDATE (allowed by the column-level
    grant in database/03_profile_management.sql) and real_name
    goes through update_real_name() to get re-encrypted. But if
    get_my_profile() comes back with NO row — meaning
    create_profile() never ran for this account (e.g. they
    confirmed their email on a different device than the one they
    registered on, so auth-login.js's handoff never happened) —
    saving falls back to calling create_profile() directly
    instead, same as a first-time signup would have. hasProfile
    tracks which path applies.

  - Account status: shows your current status and, if you don't
    already have a pending request, buttons to ask for a change —
    "go inactive" or "leave" if you're active, "reactivate" or
    "leave" if you're inactive. submit_status_request() blocks a
    second request while one's already pending (clean error
    instead of a raw constraint violation) — the admin reviews it
    from the Notifications page, and you get a notification either
    way (see database/08_notifications.sql).

  - Email: supabaseClient.auth.updateUser({ email }) kicks off
    Supabase's built-in "secure email change" flow — it sends a
    confirmation link to the new address (and, depending on your
    dashboard's Auth settings, the old one too) before the change
    actually takes effect. That's a project-level setting under
    Authentication > Email in the Supabase dashboard, not
    something this file controls.

  - Password: supabaseClient.auth.updateUser({ password })
    applies immediately. Unlike the email flow, Supabase does NOT
    email a "your password changed" notice automatically — that
    would need a Database/Auth Hook wired to an email service,
    which is a bigger step than this page covers on its own.
  --------------------------------------------------------
*/

const profileView = document.getElementById("profile-view");
const profileEditBtn = document.getElementById("profile-edit-btn");
const profileForm = document.getElementById("profile-form");
const profileError = document.getElementById("profile-error");
const profileSuccess = document.getElementById("profile-success");
const profileSubmitBtn = document.getElementById("profile-submit-btn");

const GENDER_LABELS = { male: "Male", female: "Female", other: "Other" };

let currentUser = null;
let hasProfile = false;
let editing = false;

// Shows the view block + Edit button, or the form, depending on
// hasProfile/editing. Called after loading, after clicking Edit,
// and after a successful save.
function renderProfileUI() {
  const showForm = editing || !hasProfile;
  profileView.hidden = showForm;
  profileEditBtn.hidden = showForm || !hasProfile;
  profileForm.hidden = !showForm;
}

function updateProfileView(profile) {
  document.getElementById("view-in-game-name").textContent = profile.in_game_name || "—";
  document.getElementById("view-real-name").textContent = profile.real_name || "—";
  document.getElementById("view-discord-username").textContent = profile.discord_username || "—";
  document.getElementById("view-gender").textContent = GENDER_LABELS[profile.gender] || "Other";
}

async function loadProfile(user) {
  currentUser = user;

  const { data, error } = await supabaseClient.rpc("get_my_profile");

  if (error) {
    profileError.textContent = "Couldn't load your profile: " + error.message;
    return;
  }
  if (!data || data.length === 0) {
    // No row yet — nothing to view, so skip straight to edit mode.
    // Submitting will CREATE the row (see the submit handler)
    // instead of updating it.
    hasProfile = false;
    editing = true;
    profileSuccess.textContent = "Welcome! Fill this in to finish setting up your account.";
    renderProfileUI();
    return;
  }

  hasProfile = true;
  editing = false;
  const profile = data[0];
  document.getElementById("in-game-name").value = profile.in_game_name || "";
  document.getElementById("real-name").value = profile.real_name || "";
  document.getElementById("discord-username").value = profile.discord_username || "";

  const genderInput = document.querySelector(`input[name="gender"][value="${profile.gender}"]`);
  if (genderInput) genderInput.checked = true;

  updateProfileView(profile);
  renderProfileUI();
}

// Soft, non-blocking heads-up — never prevents saving, just flags
// that another account already has this exact real name (case/
// whitespace-insensitive) so a member can double-check before
// submitting. is_real_name_taken() excludes the caller's own row,
// so re-saving your own unchanged name never warns about yourself.
const realNameInput = document.getElementById("real-name");
const realNameWarning = document.getElementById("real-name-warning");

realNameInput.addEventListener("blur", async () => {
  const value = realNameInput.value.trim();
  realNameWarning.textContent = "";
  if (!value) return;

  const { data: taken } = await supabaseClient.rpc("is_real_name_taken", { p_real_name: value });
  if (taken) {
    realNameWarning.textContent = "Someone else has already registered this name — if that's not you, double check.";
  }
});

profileEditBtn.addEventListener("click", () => {
  editing = true;
  profileError.textContent = "";
  profileSuccess.textContent = "";
  realNameWarning.textContent = "";
  renderProfileUI();
});

profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  profileError.textContent = "";
  profileSuccess.textContent = "";
  realNameWarning.textContent = "";

  const inGameName = document.getElementById("in-game-name").value.trim();
  const realName = document.getElementById("real-name").value.trim();
  const discordUsername = document.getElementById("discord-username").value.trim();
  const genderInput = document.querySelector('input[name="gender"]:checked');
  const gender = genderInput ? genderInput.value : "other";

  if (!inGameName || !realName) {
    profileError.textContent = "In-game name and real name can't be empty.";
    return;
  }

  profileSubmitBtn.disabled = true;
  profileSubmitBtn.textContent = "Saving…";

  if (!hasProfile) {
    // First-time creation — same function registration would have
    // called, just running now that we actually have a session.
    const { error } = await supabaseClient.rpc("create_profile", {
      p_in_game_name: inGameName,
      p_real_name: realName,
      p_discord_username: discordUsername || null,
      p_gender: gender,
    });

    profileSubmitBtn.disabled = false;
    profileSubmitBtn.textContent = "Save changes";

    if (error) {
      profileError.textContent = "Couldn't save your profile: " + error.message;
      return;
    }

    hasProfile = true;
    editing = false;
    updateProfileView({ in_game_name: inGameName, real_name: realName, discord_username: discordUsername, gender });
    renderProfileUI();
    profileSuccess.textContent = "Saved!";
    return;
  }

  const { error: updateError } = await supabaseClient
    .from("profiles")
    .update({
      in_game_name: inGameName,
      discord_username: discordUsername || null,
      gender,
    })
    .eq("id", currentUser.id);

  const { error: nameError } = await supabaseClient.rpc("update_real_name", {
    p_real_name: realName,
  });

  profileSubmitBtn.disabled = false;
  profileSubmitBtn.textContent = "Save changes";

  if (updateError || nameError) {
    // This particular update goes straight through a column-level
    // grant, not a wrapping function (see the file header) — so a
    // uniqueness violation surfaces as Postgres's raw constraint
    // error (code 23505) instead of a friendly custom message like
    // create_profile() raises. Translate it here instead.
    const err = updateError || nameError;
    profileError.textContent = err.code === "23505"
      ? "That in-game name or Discord username is already in use by another account."
      : "Couldn't save your profile: " + err.message;
    return;
  }

  editing = false;
  updateProfileView({ in_game_name: inGameName, real_name: realName, discord_username: discordUsername, gender });
  renderProfileUI();
  profileSuccess.textContent = "Saved!";
});

const emailForm = document.getElementById("email-form");
const emailError = document.getElementById("email-error");
const emailSuccess = document.getElementById("email-success");
const emailSubmitBtn = document.getElementById("email-submit-btn");

emailForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  emailError.textContent = "";
  emailSuccess.textContent = "";

  const newEmail = document.getElementById("new-email").value.trim();
  if (!newEmail) {
    emailError.textContent = "Enter a new email address.";
    return;
  }

  emailSubmitBtn.disabled = true;
  emailSubmitBtn.textContent = "Sending…";

  const { error } = await supabaseClient.auth.updateUser({ email: newEmail });

  emailSubmitBtn.disabled = false;
  emailSubmitBtn.textContent = "Update email";

  if (error) {
    emailError.textContent = error.message;
    return;
  }

  emailSuccess.textContent = "Check your new inbox for a confirmation link.";
  emailForm.reset();
});

const passwordForm = document.getElementById("password-form");
const passwordError = document.getElementById("password-error");
const passwordSuccess = document.getElementById("password-success");
const passwordSubmitBtn = document.getElementById("password-submit-btn");

initPasswordChecklist(document.getElementById("new-password"), document.getElementById("password-checklist"));

passwordForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  passwordError.textContent = "";
  passwordSuccess.textContent = "";

  const newPassword = document.getElementById("new-password").value;
  const confirmPassword = document.getElementById("confirm-password").value;

  const passwordProblem = passwordStrengthError(newPassword);
  if (passwordProblem) {
    passwordError.textContent = passwordProblem;
    return;
  }
  if (newPassword !== confirmPassword) {
    passwordError.textContent = "Passwords don't match.";
    return;
  }

  passwordSubmitBtn.disabled = true;
  passwordSubmitBtn.textContent = "Saving…";

  const { error } = await supabaseClient.auth.updateUser({ password: newPassword });

  passwordSubmitBtn.disabled = false;
  passwordSubmitBtn.textContent = "Update password";

  if (error) {
    passwordError.textContent = error.message;
    return;
  }

  passwordSuccess.textContent = "Password updated.";
  passwordForm.reset();
});

async function loadStatusCard(user) {
  const currentEl = document.getElementById("status-current");
  const pendingNoticeEl = document.getElementById("status-pending-notice");
  const pendingValueEl = document.getElementById("status-pending-value");
  const actionsEl = document.getElementById("status-actions");
  const errorEl = document.getElementById("status-error");
  const successEl = document.getElementById("status-success");

  const [{ data: profile }, { data: pendingRequests }] = await Promise.all([
    supabaseClient.from("profiles").select("status").eq("id", user.id).single(),
    supabaseClient.from("leave_requests").select("requested_status").eq("user_id", user.id).eq("status", "pending"),
  ]);

  const currentStatus = profile ? profile.status : "active";
  currentEl.textContent = `Your current status: ${currentStatus}.`;

  const pending = pendingRequests && pendingRequests[0];
  if (pending) {
    pendingValueEl.textContent = pending.requested_status;
    pendingNoticeEl.hidden = false;
    actionsEl.innerHTML = "";
    return;
  }
  pendingNoticeEl.hidden = true;

  const options = currentStatus === "inactive"
    ? [{ label: "Request to reactivate", value: "active" }, { label: "Request to leave", value: "left" }]
    : [{ label: "Request to go inactive", value: "inactive" }, { label: "Request to leave", value: "left" }];

  actionsEl.innerHTML = options
    .map(o => `<button type="button" class="btn-ghost" data-request-status="${o.value}">${o.label}</button>`)
    .join("");

  actionsEl.querySelectorAll("[data-request-status]").forEach(btn => {
    btn.addEventListener("click", async () => {
      errorEl.textContent = "";
      successEl.textContent = "";
      btn.disabled = true;

      const { error } = await supabaseClient.rpc("submit_status_request", {
        p_requested_status: btn.dataset.requestStatus,
      });

      if (error) {
        btn.disabled = false;
        errorEl.textContent = error.message;
        return;
      }

      successEl.textContent = "Request submitted — an admin will review it.";
      loadStatusCard(user);
    });
  });
}
