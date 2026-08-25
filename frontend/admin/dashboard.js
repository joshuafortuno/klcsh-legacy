/*
  DASHBOARD.JS
  --------------------------------------------------------
  Pulls together a handful of independent queries into one
  summary view: the current period's goal vs. what's actually
  been collected, active member count, pending-item counts (via
  the cheap admin_pending_counts() function, no decryption
  needed just to show a badge), and a recent-activity feed from
  status_audit_log. money()/formatDateTime()/escapeHtml() come
  from /utils.js, loaded before this file.
  --------------------------------------------------------
*/

// details.reason (a payment rejection reason) and details.month are
// free text an admin typed elsewhere — escaped before they land in
// this page's innerHTML, same as every other admin-authored or
// member-authored string on the site.
function describeActivity(entry) {
  const details = entry.details || {};
  switch (entry.action) {
    case "status_change":
      return `Status changed ${details.from ? `from ${escapeHtml(details.from)} ` : ""}to ${escapeHtml(details.to)}${details.reason ? ` (${escapeHtml(details.reason.replace(/_/g, " "))})` : ""}`;
    case "role_change":
      return `Role changed from ${escapeHtml(details.from)} to ${escapeHtml(details.to)}`;
    case "payment_approved":
      return "A payment submission was approved";
    case "payment_rejected":
      return `A payment submission was rejected${details.reason ? `: "${escapeHtml(details.reason)}"` : ""}`;
    case "period_finalized":
      return `Period ${escapeHtml(details.month || "")} finalized — ${money(details.total_expenses || 0)} in expenses, surplus ${money(details.surplus || 0)}`;
    default:
      return escapeHtml(entry.action.replace(/_/g, " "));
  }
}

async function loadDashboard() {
  const statsEl = document.getElementById("admin-stats");
  const feedEl = document.getElementById("activity-feed");

  const [
    periodResult,
    activeCountResult,
    countsResult,
    activityResult,
  ] = await Promise.all([
    supabaseClient.rpc("admin_get_or_create_open_period"),
    supabaseClient.from("profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabaseClient.rpc("admin_pending_counts"),
    supabaseClient.from("status_audit_log").select("*").order("created_at", { ascending: false }).limit(8),
  ]);

  const period = periodResult.data;
  const activeCount = activeCountResult.count || 0;
  const counts = countsResult.data && countsResult.data[0]
    ? countsResult.data[0]
    : { pending_payments: 0, pending_leave_requests: 0, expired_ranks: 0, pending_deliveries: 0 };

  let goalTotal = 0;
  let raised = 0;
  if (period) {
    const [expensesResult, progressResult] = await Promise.all([
      supabaseClient.from("expenses").select("amount").eq("period_id", period.id),
      supabaseClient.rpc("period_progress", { p_period_id: period.id }),
    ]);
    goalTotal = (expensesResult.data || []).reduce((sum, e) => sum + Number(e.amount), 0);
    raised = progressResult.data || 0;
  }

  const pendingTotal = counts.pending_payments + counts.pending_leave_requests + counts.expired_ranks + counts.pending_deliveries;

  statsEl.innerHTML = `
    <div class="admin-stat">
      <div class="admin-stat-value">${money(raised)}</div>
      <div class="admin-stat-label">Raised — ${period ? escapeHtml(period.title) || "This month" : "This month"}</div>
    </div>
    <div class="admin-stat">
      <div class="admin-stat-value">${money(goalTotal)}</div>
      <div class="admin-stat-label">Goal (itemized expenses so far)</div>
    </div>
    <div class="admin-stat">
      <div class="admin-stat-value">${activeCount}</div>
      <div class="admin-stat-label">Active members</div>
    </div>
    <div class="admin-stat ${pendingTotal > 0 ? "needs-attention" : ""}">
      <div class="admin-stat-value">${pendingTotal}</div>
      <div class="admin-stat-label">Pending in Notifications</div>
    </div>
  `;

  const activity = activityResult.data || [];
  feedEl.innerHTML = activity.length === 0
    ? `<div class="admin-empty">No admin activity logged yet.</div>`
    : activity.map(entry => `
        <div class="activity-item">
          <div>${describeActivity(entry)}</div>
          <div class="activity-time">${formatDateTime(entry.created_at)}</div>
        </div>
      `).join("");
}
