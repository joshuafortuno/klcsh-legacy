/*
  CONTRIBUTORS.JS
  --------------------------------------------------------
  Everyone except yourself, excluding anyone with status 'left'
  (soft-deleted members shouldn't show up in a public roster).
  Plain select against profiles — already covered by the existing
  "profiles are viewable by all logged-in users" policy, same one
  the header avatar/role lookup already relies on. avatarSvg() is
  defined in auth-guard.js, loaded before this file, so it's
  reused as-is rather than redefined here.
  --------------------------------------------------------
*/

let allContributors = [];

function renderContributors() {
  const needle = document.getElementById("contributors-search").value.trim().toLowerCase();

  const filtered = needle
    ? allContributors.filter(c => c.in_game_name.toLowerCase().includes(needle))
    : allContributors;

  const listEl = document.getElementById("contributor-list");
  const emptyEl = document.getElementById("contributor-empty");

  if (filtered.length === 0) {
    listEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="ledger-empty">No contributors match.</div>`;
    return;
  }

  emptyEl.innerHTML = "";
  listEl.innerHTML = filtered.map(c => `
    <div class="contributor-card">
      <div class="contributor-avatar">${avatarSvg(c.gender)}</div>
      <div class="contributor-info">
        <div class="contributor-name">${c.in_game_name}</div>
        <div class="contributor-meta">
          <span class="status-badge status-badge--${c.role}">${c.role}</span>
          <span class="status-badge status-badge--${c.status}">${c.status}</span>
        </div>
      </div>
    </div>
  `).join("");
}

async function loadContributors(user) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, in_game_name, gender, role, status")
    .neq("id", user.id)
    .neq("status", "left")
    .order("in_game_name", { ascending: true });

  if (error) {
    document.getElementById("contributor-empty").innerHTML =
      `<div class="ledger-empty">Couldn't load contributors: ${error.message}</div>`;
    return;
  }

  allContributors = data || [];
  renderContributors();

  document.getElementById("contributors-search").addEventListener("input", renderContributors);
}
