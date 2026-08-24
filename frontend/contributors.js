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

  Paged 10 at a time (same pattern as the member ledger) — the
  roster only grows as the community does, so this won't stay
  small forever.
  --------------------------------------------------------
*/

const PAGE_SIZE = 10;
let allContributors = [];
let contributorsPage = 1;

function renderContributors() {
  const needle = document.getElementById("contributors-search").value.trim().toLowerCase();

  const filtered = needle
    ? allContributors.filter(c => c.in_game_name.toLowerCase().includes(needle))
    : allContributors;

  const listEl = document.getElementById("contributor-list");
  const emptyEl = document.getElementById("contributor-empty");
  const prevBtn = document.getElementById("contributors-prev-page");
  const nextBtn = document.getElementById("contributors-next-page");

  if (filtered.length === 0) {
    listEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="ledger-empty">No contributors match.</div>`;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  contributorsPage = Math.min(contributorsPage, totalPages);
  const start = (contributorsPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  emptyEl.innerHTML = "";
  listEl.innerHTML = pageItems.map(c => `
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

  prevBtn.disabled = contributorsPage <= 1;
  nextBtn.disabled = contributorsPage >= totalPages;
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

  document.getElementById("contributors-search").addEventListener("input", () => {
    contributorsPage = 1;
    renderContributors();
  });
  document.getElementById("contributors-prev-page").addEventListener("click", () => {
    contributorsPage -= 1;
    renderContributors();
  });
  document.getElementById("contributors-next-page").addEventListener("click", () => {
    contributorsPage += 1;
    renderContributors();
  });
}
