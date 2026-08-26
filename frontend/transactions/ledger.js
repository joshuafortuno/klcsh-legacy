/*
  LEDGER.JS — the full contributions page
  --------------------------------------------------------
  Reads the full public ledger via public_contribution_ledger()
  (database/13_shop_display.sql, extending 09_public_ledger.sql) —
  a union of the pre-launch legacy_contributions history and every
  APPROVED live payment_submissions row, so this list actually keeps
  growing as real payments clear instead of staying frozen at the
  historical import. Live rows also carry what the payment was
  actually for (dues/side-goal, rank, Legacy Pass) — legacy rows
  predate all of that, so they report none of it and just render as
  a plain single line, same as they always have.
  money()/formatDate()/escapeHtml() come from /utils.js, loaded
  before this file.

  Fetched once into `allContributions`, then search + pagination
  both work against that in-memory list — this site isn't going
  to have thousands of rows, so there's no need for server-side
  paging.
  --------------------------------------------------------
*/

function renderLedgerRows(contributions) {
  if (contributions.length === 0) {
    return `<div class="ledger-empty">No contributions match that search.</div>`;
  }

  return contributions.map(c => {
    const tags = [];
    if (c.targetLabel) tags.push(`<span class="status-badge status-badge--open">${escapeHtml(c.targetLabel)}</span>`);
    if (c.rankPurchased) tags.push(`<span class="status-badge status-badge--${c.rankPurchased}">${c.rankPurchased}</span>`);
    if (c.battlepassPurchased) tags.push(`<span class="status-badge status-badge--battlepass">Battlepass</span>`);

    if (tags.length === 0) {
      return `
        <div class="ledger-row">
          <div class="ledger-who">
            <span class="ledger-name">${escapeHtml(c.name)}</span>
          </div>
          <div class="ledger-right">
            <span class="ledger-date">${formatDate(c.date)}</span>
            <span class="ledger-amount">+${money(c.amount)}</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="ledger-row ledger-row--stacked">
        <div class="ledger-who">
          <span class="ledger-name">${escapeHtml(c.name)}</span>
        </div>
        <div class="ledger-tags">${tags.join("")}</div>
        <div class="ledger-right">
          <span class="ledger-date">${formatDate(c.date)}</span>
          <span class="ledger-amount">+${money(c.amount)}</span>
        </div>
      </div>
    `;
  }).join("");
}

const PAGE_SIZE = 10;
let currentPage = 1;
let allContributions = [];

const prevBtn = document.getElementById("prev-page");
const nextBtn = document.getElementById("next-page");

function renderFullLedger(filterText = "") {
  const el = document.getElementById("ledger-full");
  const needle = filterText.trim().toLowerCase();

  const filtered = needle
    ? allContributions.filter(c => c.name.toLowerCase().includes(needle))
    : allContributions;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  el.innerHTML = renderLedgerRows(pageItems);

  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

async function loadLedger() {
  const { data, error } = await supabaseClient.rpc("public_contribution_ledger");

  if (error) {
    document.getElementById("ledger-full").innerHTML =
      `<div class="ledger-empty">Couldn't load contributions: ${escapeHtml(error.message)}</div>`;
    return;
  }

  allContributions = (data || [])
    .map(row => ({
      name: row.contributor_name,
      amount: row.amount,
      date: row.contributed_on,
      sortAt: row.sort_at,
      targetLabel: row.target_label,
      rankPurchased: row.rank_purchased,
      battlepassPurchased: row.battlepass_purchased,
    }))
    // Full timestamp, not just the date — two contributions on the
    // same calendar day still need a real most-recent-first order
    // (see public_contribution_ledger()'s sort_at in
    // database/19_ledger_sort_precision.sql), not whatever order
    // the query happened to return them in. Falls back to the
    // day-only `date` if sort_at is ever missing (e.g. that
    // migration hasn't been run yet against this database) — better
    // than every comparison silently returning NaN, which browsers
    // treat as "leave it in whatever order the query returned," and
    // that raw order tends to put the newest row last.
    .sort((a, b) => new Date(b.sortAt || b.date) - new Date(a.sortAt || a.date));

  renderFullLedger();

  document.getElementById("ledger-search").addEventListener("input", (e) => {
    currentPage = 1;
    renderFullLedger(e.target.value);
  });

  prevBtn.addEventListener("click", () => {
    currentPage -= 1;
    renderFullLedger(document.getElementById("ledger-search").value);
  });

  nextBtn.addEventListener("click", () => {
    currentPage += 1;
    renderFullLedger(document.getElementById("ledger-search").value);
  });
}

loadLedger();
