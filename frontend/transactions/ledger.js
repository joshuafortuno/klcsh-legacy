/*
  LEDGER.JS — the full contributions page
  --------------------------------------------------------
  Re-uses the same money/date/row helpers as script.js would,
  but since this is a separate page load, we redefine the
  small ones here to keep each page's script self-contained
  and easy to read on its own.
  --------------------------------------------------------
*/

function money(n) {
  return `₱${n.toLocaleString()}`;
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
        ${c.message ? `<span class="ledger-msg">"${c.message}"</span>` : ""}
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

const prevBtn = document.getElementById("prev-page");
const nextBtn = document.getElementById("next-page");

function renderFullLedger(filterText = "") {
  const el = document.getElementById("ledger-full");
  const needle = filterText.trim().toLowerCase();

  const filtered = needle
    ? CONTRIBUTIONS.filter(c => c.name.toLowerCase().includes(needle))
    : CONTRIBUTIONS;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  el.innerHTML = renderLedgerRows(pageItems);

  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

// Live-filter as the user types in the search box — back to page 1,
// since the old page number might not exist in the new results.
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

renderFullLedger();
