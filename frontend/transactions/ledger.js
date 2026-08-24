/*
  LEDGER.JS — the full contributions page
  --------------------------------------------------------
  Reads real history from Supabase's legacy_contributions table
  (see database/05_legacy_contributions.sql) — the actual record
  from the spreadsheet this site was adapted from, predating
  accounts entirely, so there's no per-member RLS filtering here:
  "legacy contributions are viewable by all logged-in users" is a
  plain public-read policy, same as periods/expenses.

  Fetched once into `allContributions`, then search + pagination
  both work against that in-memory list — this site isn't going
  to have thousands of rows, so there's no need for server-side
  paging.
  --------------------------------------------------------
*/

function money(n) {
  return `₱${Number(n).toLocaleString()}`;
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function renderLedgerRows(contributions) {
  if (contributions.length === 0) {
    return `<div class="ledger-empty">No contributions match that search.</div>`;
  }

  return contributions.map(c => `
    <div class="ledger-row">
      <div class="ledger-who">
        <span class="ledger-name">${c.name}</span>
      </div>
      <div class="ledger-right">
        <span class="ledger-date">${formatDate(c.date)}</span>
        <span class="ledger-amount">+${money(c.amount)}</span>
      </div>
    </div>
  `).join("");
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
  const { data, error } = await supabaseClient
    .from("legacy_contributions")
    .select("contributor_name, amount, contributed_on")
    .order("contributed_on", { ascending: false });

  if (error) {
    document.getElementById("ledger-full").innerHTML =
      `<div class="ledger-empty">Couldn't load contributions: ${error.message}</div>`;
    return;
  }

  allContributions = (data || []).map(row => ({
    name: row.contributor_name,
    amount: row.amount,
    date: row.contributed_on,
  }));

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
