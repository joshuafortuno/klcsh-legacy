/*
  MY-CONTRIBUTIONS.JS
  --------------------------------------------------------
  Every payment_submissions row the signed-in member has ever
  made, self-view only via the existing "users can view their own
  payment submissions" RLS policy — no RPC/decryption needed since
  nobody has to decrypt anything to see their own history. periods/
  side_goals come along via PostgREST's automatic foreign-key
  embedding (payment_submissions.period_id/side_goal_id each have
  exactly one FK target, so it resolves without needing to name
  the relationship explicitly).

  Fetched once, filtered client-side by the status dropdown, and
  paged 10 at a time — a member submitting monthly dues plus the
  occasional side-goal chip-in will pass 10 rows within a year or
  so, so this is worth paging from the start.
  --------------------------------------------------------
*/

const PAGE_SIZE = 10;

// money()/formatDate()/escapeHtml() come from /utils.js, loaded
// before this file.

function targetLabel(row) {
  if (row.side_goals) return escapeHtml(row.side_goals.title);
  if (row.periods) {
    return new Date(row.periods.month).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  return "—";
}

let allMyContributions = [];
let myContributionsPage = 1;

function renderMyContributions() {
  const status = document.getElementById("my-status-filter").value;

  const filtered = status
    ? allMyContributions.filter(row => row.status === status)
    : allMyContributions;

  const listEl = document.getElementById("my-contributions-list");
  const emptyEl = document.getElementById("my-contributions-empty");
  const prevBtn = document.getElementById("my-contributions-prev-page");
  const nextBtn = document.getElementById("my-contributions-next-page");

  if (filtered.length === 0) {
    listEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="ledger-empty">Nothing here yet.</div>`;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  myContributionsPage = Math.min(myContributionsPage, totalPages);
  const start = (myContributionsPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  emptyEl.innerHTML = "";
  listEl.innerHTML = pageItems.map(row => `
    <div class="ledger-row ledger-row--stacked">
      <div class="ledger-who">
        <span class="ledger-name">${targetLabel(row)}</span>
      </div>
      <div class="ledger-tags">
        <span class="status-badge status-badge--${row.status}">${row.status}</span>
        ${row.rank_purchased ? `<span class="status-badge status-badge--${row.rank_purchased}">${row.rank_purchased}</span>` : ""}
        ${row.battlepass_purchased ? `<span class="status-badge status-badge--battlepass">Battlepass</span>` : ""}
      </div>
      <div class="ledger-right">
        <span class="ledger-date">${formatDate(row.submitted_at)}</span>
        <span class="ledger-amount">${money(row.amount_claimed)}</span>
      </div>
      ${row.rejection_reason ? `<div class="ledger-msg">"${escapeHtml(row.rejection_reason)}"</div>` : ""}
    </div>
  `).join("");

  prevBtn.disabled = myContributionsPage <= 1;
  nextBtn.disabled = myContributionsPage >= totalPages;
}

async function loadMyContributions(user) {
  const { data, error } = await supabaseClient
    .from("payment_submissions")
    .select("id, amount_claimed, status, rejection_reason, submitted_at, rank_purchased, battlepass_purchased, periods(month), side_goals(title)")
    .eq("user_id", user.id)
    .order("submitted_at", { ascending: false });

  if (error) {
    document.getElementById("my-contributions-empty").innerHTML =
      `<div class="ledger-empty">Couldn't load your contributions: ${error.message}</div>`;
    return;
  }

  allMyContributions = data || [];
  renderMyContributions();

  document.getElementById("my-status-filter").addEventListener("change", () => {
    myContributionsPage = 1;
    renderMyContributions();
  });
  document.getElementById("my-contributions-prev-page").addEventListener("click", () => {
    myContributionsPage -= 1;
    renderMyContributions();
  });
  document.getElementById("my-contributions-next-page").addEventListener("click", () => {
    myContributionsPage += 1;
    renderMyContributions();
  });
}
