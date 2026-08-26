/*
  CONTRIBUTORS.JS
  --------------------------------------------------------
  Everyone, including yourself (tagged "(You)" on your own card so
  it's clear which one you are), excluding anyone with status 'left'
  (soft-deleted members shouldn't show up in a public roster).
  Plain select against profiles — already covered by the existing
  "profiles are viewable by all logged-in users" policy, same one
  the header avatar/role lookup already relies on. avatarSvg() is
  defined in auth-guard.js, loaded before this file, so it's
  reused as-is rather than redefined here.

  Rank badge REPLACES the member/admin role badge in the display
  when a rank is active — the person is still a `member` underneath
  (rank is a display override only, see database/11_shop_core.sql).
  Whether someone has an active Legacy Pass comes from
  public_active_battlepass_holders() — battlepass_cycles itself is
  self-view-only, this is a public aggregate the same way
  period_progress()/side_goal_progress() are, exposing nothing but
  "yes/no, do they currently have one."

  Paged 10 at a time (same pattern as the member ledger) — the
  roster only grows as the community does, so this won't stay
  small forever.
  --------------------------------------------------------
*/

const PAGE_SIZE = 10;
let allContributors = [];
let contributorsPage = 1;
let currentUserId = null;

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
  listEl.innerHTML = pageItems.map(c => {
    const roleOrRankBadge = c.rank && c.rank !== "none"
      ? `<span class="status-badge status-badge--${c.rank}">${c.rank}</span>`
      : `<span class="status-badge status-badge--${c.role}">${c.role}</span>`;
    const battlepassBadge = c.hasBattlepass ? `<span class="status-badge status-badge--battlepass">Battlepass</span>` : "";

    const isYou = c.id === currentUserId;

    return `
      <div class="contributor-card">
        <div class="contributor-avatar">${avatarSvg(c.gender)}</div>
        <div class="contributor-info">
          <div class="contributor-name">${escapeHtml(c.in_game_name)}${isYou ? ` <span class="contributor-you">(You)</span>` : ""}</div>
          <div class="contributor-meta">
            <span class="status-badge status-badge--${c.status}">${c.status}</span>
            ${roleOrRankBadge}
            ${battlepassBadge}
          </div>
        </div>
      </div>
    `;
  }).join("");

  prevBtn.disabled = contributorsPage <= 1;
  nextBtn.disabled = contributorsPage >= totalPages;
}

async function loadContributors(user) {
  currentUserId = user.id;

  const [{ data, error }, { data: battlepassHolders }] = await Promise.all([
    supabaseClient
      .from("profiles")
      .select("id, in_game_name, gender, role, status, rank")
      .neq("status", "left")
      .order("in_game_name", { ascending: true }),
    supabaseClient.rpc("public_active_battlepass_holders"),
  ]);

  if (error) {
    document.getElementById("contributor-empty").innerHTML =
      `<div class="ledger-empty">Couldn't load contributors: ${escapeHtml(error.message)}</div>`;
    return;
  }

  const activeBattlepassIds = new Set((battlepassHolders || []).map(row => row.user_id));
  allContributors = (data || []).map(c => ({ ...c, hasBattlepass: activeBattlepassIds.has(c.id) }));

  // Your own card always leads, ahead of the alphabetical order —
  // a stable sort (guaranteed since ES2019) means every other pair
  // keeps the order the query already gave them.
  allContributors.sort((a, b) => (a.id === currentUserId ? -1 : b.id === currentUserId ? 1 : 0));

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
