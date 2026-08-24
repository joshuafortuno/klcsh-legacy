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

  Fetched once, filtered client-side by the status dropdown — this
  is one member's own history, never going to be large enough to
  need server-side filtering.
  --------------------------------------------------------
*/

function money(n) {
  return `₱${Number(n).toLocaleString()}`;
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function targetLabel(row) {
  if (row.side_goals) return row.side_goals.title;
  if (row.periods) {
    return new Date(row.periods.month).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  return "—";
}

let allMyContributions = [];

function renderMyContributions() {
  const status = document.getElementById("my-status-filter").value;

  const filtered = status
    ? allMyContributions.filter(row => row.status === status)
    : allMyContributions;

  const listEl = document.getElementById("my-contributions-list");
  const emptyEl = document.getElementById("my-contributions-empty");

  if (filtered.length === 0) {
    listEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="ledger-empty">Nothing here yet.</div>`;
    return;
  }

  emptyEl.innerHTML = "";
  listEl.innerHTML = filtered.map(row => `
    <div class="ledger-row">
      <div class="ledger-who">
        <span class="ledger-name">${targetLabel(row)}</span>
        <span class="status-badge status-badge--${row.status}">${row.status}</span>
        ${row.rejection_reason ? `<span class="ledger-msg">"${row.rejection_reason}"</span>` : ""}
      </div>
      <div class="ledger-right">
        <span class="ledger-date">${formatDate(row.submitted_at)}</span>
        <span class="ledger-amount">${money(row.amount_claimed)}</span>
      </div>
    </div>
  `).join("");
}

async function loadMyContributions(user) {
  const { data, error } = await supabaseClient
    .from("payment_submissions")
    .select("id, amount_claimed, status, rejection_reason, submitted_at, periods(month), side_goals(title)")
    .eq("user_id", user.id)
    .order("submitted_at", { ascending: false });

  if (error) {
    document.getElementById("my-contributions-empty").innerHTML =
      `<div class="ledger-empty">Couldn't load your contributions: ${error.message}</div>`;
    return;
  }

  allMyContributions = data || [];
  renderMyContributions();

  document.getElementById("my-status-filter").addEventListener("change", renderMyContributions);
}
