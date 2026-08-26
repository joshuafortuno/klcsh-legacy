/*
  MANAGE-ACCOUNTS.JS
  --------------------------------------------------------
  admin_list_profiles() decrypts every member's real name in one
  call (rather than one decrypt per row) and returns everything
  this page needs, including rank/rank_expires_at and their active
  Legacy Pass expiry (if any) — see database/25_manage_accounts_edit.sql.

  Role and Status used to be inline <select>s that saved the moment
  you changed them. Now every field — including those two — lives in
  one "Edit" form (same toggle-and-prefill pattern as the manual
  payment entry form on the admin Contributions page) rather than
  being scattered across per-cell controls:
    - In-game name / real name / Discord: admin_update_member_profile().
    - Role / Status: admin_set_role()/admin_set_status(), same
      functions as before, just called from the form's Save instead
      of a cell's onchange.
    - Rank: admin_set_member_rank() — a direct override (tier + days
      remaining), not a simulated purchase, so it deliberately
      ignores the upgrade/downgrade rules a real purchase enforces.
      0 days (or "None") clears the rank entirely.
    - Legacy Pass: admin_set_member_battlepass() — a plain on/off
      toggle rather than a "days remaining" field, since a pass is
      always exactly 31 days when active. Turning it on always
      (re)starts a fresh cycle at day 1, replacing whatever was
      there rather than stacking onto it.

  Paged 10 at a time — this lists every member, not just active
  ones, so it grows with the community's full history.
  --------------------------------------------------------
*/

const PAGE_SIZE = 10;
let allProfiles = [];
let accountsPage = 1;

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function renderRows() {
  const needle = document.getElementById("accounts-search").value.trim().toLowerCase();

  const filtered = needle
    ? allProfiles.filter(p =>
        p.in_game_name.toLowerCase().includes(needle) ||
        (p.real_name || "").toLowerCase().includes(needle))
    : allProfiles;

  const rowsEl = document.getElementById("accounts-rows");
  const emptyEl = document.getElementById("accounts-empty");
  const prevBtn = document.getElementById("accounts-prev-page");
  const nextBtn = document.getElementById("accounts-next-page");

  if (filtered.length === 0) {
    rowsEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="admin-empty">No members match.</div>`;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  accountsPage = Math.max(1, Math.min(accountsPage, totalPages));
  const start = (accountsPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  emptyEl.innerHTML = "";
  rowsEl.innerHTML = pageItems.map(p => `
    <tr>
      <td>${escapeHtml(p.in_game_name)}</td>
      <td>${escapeHtml(p.real_name) || "—"}</td>
      <td>${escapeHtml(p.discord_username) || "—"}</td>
      <td>${capitalize(p.role)}</td>
      <td>${capitalize(p.status)}</td>
      <td><button type="button" class="btn-small" data-edit-account="${p.id}">Edit</button></td>
    </tr>
  `).join("");

  rowsEl.querySelectorAll("[data-edit-account]").forEach(btn => {
    btn.addEventListener("click", () => {
      const profile = allProfiles.find(p => p.id === btn.dataset.editAccount);
      if (profile) openEditForm(profile);
    });
  });

  prevBtn.disabled = accountsPage <= 1;
  nextBtn.disabled = accountsPage >= totalPages;
}

function openEditForm(profile) {
  document.getElementById("edit-account-error").textContent = "";
  document.getElementById("edit-account-name-heading").textContent = profile.in_game_name;

  document.getElementById("edit-account-id").value = profile.id;
  document.getElementById("edit-in-game-name").value = profile.in_game_name || "";
  document.getElementById("edit-real-name").value = profile.real_name || "";
  document.getElementById("edit-discord-username").value = profile.discord_username || "";
  document.getElementById("edit-role").value = profile.role;
  document.getElementById("edit-status").value = profile.status;

  const rankActive = profile.rank && profile.rank !== "none" && profile.rank_expires_at && new Date(profile.rank_expires_at) > new Date();
  document.getElementById("edit-rank").value = rankActive ? profile.rank : "none";
  document.getElementById("edit-rank-days").value = rankActive
    ? Math.max(0, Math.ceil((new Date(profile.rank_expires_at).getTime() - Date.now()) / 86400000))
    : "";

  const battlepassActive = profile.battlepass_expires_at && new Date(profile.battlepass_expires_at) > new Date();
  document.getElementById("edit-battlepass-active").checked = !!battlepassActive;

  document.getElementById("edit-account-overlay").hidden = false;
}

function closeEditForm() {
  document.getElementById("edit-account-overlay").hidden = true;
  document.getElementById("edit-account-error").textContent = "";
}

let eventsWired = false;

function wireAccountsEvents() {
  if (eventsWired) return;
  eventsWired = true;

  document.getElementById("accounts-search").addEventListener("input", () => {
    accountsPage = 1;
    renderRows();
  });
  document.getElementById("accounts-prev-page").addEventListener("click", () => {
    accountsPage -= 1;
    renderRows();
  });
  document.getElementById("accounts-next-page").addEventListener("click", () => {
    accountsPage += 1;
    renderRows();
  });

  document.getElementById("edit-account-cancel-btn").addEventListener("click", closeEditForm);
  document.getElementById("edit-account-close-btn").addEventListener("click", closeEditForm);

  // Clicking the dimmed backdrop closes it — only when the click
  // actually started on the overlay itself, not somewhere inside
  // the panel that happens to bubble up to it.
  document.getElementById("edit-account-overlay").addEventListener("click", (e) => {
    if (e.target.id === "edit-account-overlay") closeEditForm();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("edit-account-overlay").hidden) closeEditForm();
  });

  document.getElementById("edit-account-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("edit-account-error");
    errorEl.textContent = "";

    const userId = document.getElementById("edit-account-id").value;
    const inGameName = document.getElementById("edit-in-game-name").value.trim();
    const realName = document.getElementById("edit-real-name").value.trim();
    const discordUsername = document.getElementById("edit-discord-username").value.trim();
    const role = document.getElementById("edit-role").value;
    const status = document.getElementById("edit-status").value;
    const rank = document.getElementById("edit-rank").value;
    const rankDaysRaw = document.getElementById("edit-rank-days").value;
    const rankDays = rankDaysRaw === "" ? 0 : parseInt(rankDaysRaw, 10);
    const battlepassActive = document.getElementById("edit-battlepass-active").checked;

    if (!inGameName || !realName) {
      errorEl.textContent = "In-game name and real name can't be empty.";
      return;
    }

    const submitBtn = document.getElementById("edit-account-submit-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";

    // One atomic call — see admin_update_member() in
    // database/25_manage_accounts_edit.sql. A failure partway
    // through (e.g. a duplicate in-game name) rolls back the whole
    // save instead of leaving some fields changed and others not.
    const { error } = await supabaseClient.rpc("admin_update_member", {
      p_user_id: userId,
      p_in_game_name: inGameName,
      p_real_name: realName,
      p_discord_username: discordUsername || null,
      p_role: role,
      p_status: status,
      p_rank: rank,
      p_rank_days: rankDays,
      p_battlepass_active: battlepassActive,
    });

    submitBtn.disabled = false;
    submitBtn.textContent = "Save changes";

    if (error) {
      errorEl.textContent = error.message;
      return;
    }

    closeEditForm();
    loadAccounts();
  });
}

async function loadAccounts() {
  const { data, error } = await supabaseClient.rpc("admin_list_profiles");

  if (error) {
    document.getElementById("accounts-empty").innerHTML =
      `<div class="admin-empty">Couldn't load members: ${error.message}</div>`;
    return;
  }

  allProfiles = data || [];
  renderRows();
  wireAccountsEvents();
}
