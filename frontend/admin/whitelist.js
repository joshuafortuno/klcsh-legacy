/*
  WHITELIST.JS
  --------------------------------------------------------
  Reuses admin_list_profiles() (same RPC Manage Accounts already
  calls) rather than adding a separate listing endpoint — it already
  decrypts everything in one batch and now also returns `whitelisted`
  (see database/26_whitelist.sql). 'left' members are filtered out
  here client-side, same as the "except left account status"
  requirement — there's no server-side flag on the RPC for it since
  Manage Accounts still needs the full list including 'left' members.

  Each row's toggle calls admin_set_member_whitelisted() directly on
  change — no separate "Save" step, since a whitelist toggle is a
  single on/off fact, not a multi-field form like Manage Accounts'
  edit modal. Applied optimistically (flips immediately, feels
  instant) and rolled back if the write fails, same pattern
  auth-guard.js's notification-read toggle already uses.

  No pagination here (unlike Manage Accounts) — this list is already
  bounded to non-'left' members, so it doesn't grow with the
  community's full historical roster the way the account list does.
  --------------------------------------------------------
*/

let allWhitelistProfiles = [];

function renderWhitelistRows() {
  const needle = document.getElementById("whitelist-search").value.trim().toLowerCase();

  const filtered = needle
    ? allWhitelistProfiles.filter(p => p.in_game_name.toLowerCase().includes(needle))
    : allWhitelistProfiles;

  const rowsEl = document.getElementById("whitelist-rows");
  const emptyEl = document.getElementById("whitelist-empty");

  if (filtered.length === 0) {
    rowsEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="admin-empty">No members match.</div>`;
    return;
  }

  emptyEl.innerHTML = "";
  rowsEl.innerHTML = filtered.map(p => `
    <tr>
      <td>${escapeHtml(p.in_game_name)}</td>
      <td>${p.status.charAt(0).toUpperCase() + p.status.slice(1)}</td>
      <td>
        <label class="toggle-switch">
          <input type="checkbox" data-whitelist-toggle="${p.id}" ${p.whitelisted ? "checked" : ""} />
          <span class="toggle-track" aria-hidden="true"></span>
        </label>
      </td>
    </tr>
  `).join("");

  rowsEl.querySelectorAll("[data-whitelist-toggle]").forEach(input => {
    input.addEventListener("change", () => toggleWhitelisted(input));
  });
}

async function toggleWhitelisted(input) {
  const userId = input.dataset.whitelistToggle;
  const nextValue = input.checked;
  const errorEl = document.getElementById("whitelist-error");

  errorEl.textContent = "";
  input.disabled = true;

  const { error } = await supabaseClient.rpc("admin_set_member_whitelisted", {
    p_user_id: userId,
    p_whitelisted: nextValue,
  });

  input.disabled = false;

  if (error) {
    input.checked = !nextValue; // roll back — the write didn't actually happen
    errorEl.textContent = "Couldn't update whitelist: " + error.message;
    return;
  }

  const profile = allWhitelistProfiles.find(p => p.id === userId);
  if (profile) profile.whitelisted = nextValue;
}

async function loadWhitelist() {
  const { data, error } = await supabaseClient.rpc("admin_list_profiles");

  if (error) {
    document.getElementById("whitelist-empty").innerHTML =
      `<div class="admin-empty">Couldn't load members: ${error.message}</div>`;
    return;
  }

  allWhitelistProfiles = (data || []).filter(p => p.status !== "left");
  renderWhitelistRows();

  document.getElementById("whitelist-search").addEventListener("input", renderWhitelistRows);
}
