/*
  MANAGE-ACCOUNTS.JS
  --------------------------------------------------------
  admin_list_profiles() decrypts every member's real name in one
  call (rather than one decrypt per row) and returns everything
  this page needs. Role/status changes save immediately on
  change via admin_set_role()/admin_set_status() — both check
  is_admin() server-side and log to status_audit_log themselves,
  so this file just calls them and reports errors.
  --------------------------------------------------------
*/

let allProfiles = [];

function renderRows() {
  const needle = document.getElementById("accounts-search").value.trim().toLowerCase();

  const filtered = needle
    ? allProfiles.filter(p =>
        p.in_game_name.toLowerCase().includes(needle) ||
        (p.real_name || "").toLowerCase().includes(needle))
    : allProfiles;

  const rowsEl = document.getElementById("accounts-rows");
  const emptyEl = document.getElementById("accounts-empty");

  if (filtered.length === 0) {
    rowsEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="admin-empty">No members match.</div>`;
    return;
  }

  emptyEl.innerHTML = "";
  rowsEl.innerHTML = filtered.map(p => `
    <tr data-user-id="${p.id}">
      <td>${p.in_game_name}</td>
      <td>${p.real_name || "—"}</td>
      <td>${p.discord_username || "—"}</td>
      <td>
        <select class="admin-role-select" data-role-for="${p.id}">
          <option value="member" ${p.role === "member" ? "selected" : ""}>Member</option>
          <option value="admin" ${p.role === "admin" ? "selected" : ""}>Admin</option>
        </select>
      </td>
      <td>
        <select class="admin-status-select" data-status-for="${p.id}">
          <option value="active" ${p.status === "active" ? "selected" : ""}>Active</option>
          <option value="inactive" ${p.status === "inactive" ? "selected" : ""}>Inactive</option>
          <option value="left" ${p.status === "left" ? "selected" : ""}>Left</option>
        </select>
      </td>
    </tr>
  `).join("");

  wireRowEvents();
}

function wireRowEvents() {
  const errorEl = document.getElementById("accounts-error");

  document.querySelectorAll("[data-role-for]").forEach(select => {
    select.addEventListener("change", async () => {
      errorEl.textContent = "";
      select.disabled = true;
      const { error } = await supabaseClient.rpc("admin_set_role", {
        p_user_id: select.dataset.roleFor,
        p_role: select.value,
      });
      select.disabled = false;
      if (error) {
        errorEl.textContent = error.message;
        return;
      }
      const profile = allProfiles.find(p => p.id === select.dataset.roleFor);
      if (profile) profile.role = select.value;
    });
  });

  document.querySelectorAll("[data-status-for]").forEach(select => {
    select.addEventListener("change", async () => {
      errorEl.textContent = "";
      select.disabled = true;
      const { error } = await supabaseClient.rpc("admin_set_status", {
        p_user_id: select.dataset.statusFor,
        p_status: select.value,
      });
      select.disabled = false;
      if (error) {
        errorEl.textContent = error.message;
        return;
      }
      const profile = allProfiles.find(p => p.id === select.dataset.statusFor);
      if (profile) profile.status = select.value;
    });
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

  document.getElementById("accounts-search").addEventListener("input", renderRows);
}
