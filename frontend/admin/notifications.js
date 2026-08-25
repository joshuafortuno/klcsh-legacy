/*
  NOTIFICATIONS.JS
  --------------------------------------------------------
  Two independent pending queues on one page: payments (via
  admin_list_payment_submissions('pending'), which decrypts each
  GCash reference for review) and leave requests (via
  admin_list_leave_requests('pending'), nothing encrypted there).
  Every approve/reject button calls a single admin_* function and
  re-fetches its own queue — the database function does the actual
  work (and logging), this file just wires the buttons.

  Both queues are meant to be worked down to zero regularly, so
  they'll usually be short — but if review falls behind for a
  while they can still pile up past 10, so both page the same way
  every other list on the site does.

  Note on "Proof": screenshot_url is a private Storage object PATH
  (e.g. "‹user_id›/‹timestamp›-‹filename›"), not a public URL — the
  bucket is private, so viewing it means generating a short-lived
  signed URL on demand rather than linking to it directly.
  --------------------------------------------------------
*/

const PAGE_SIZE = 10;

// money()/formatDate()/escapeHtml() come from /utils.js, loaded
// before this file.

function targetLabel(row) {
  if (row.side_goal_title) return escapeHtml(row.side_goal_title);
  if (row.period_month) {
    const d = new Date(row.period_month);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  return "—";
}

// ---------- payments ----------

let allPendingPayments = [];
let paymentsPage = 1;

function renderPaymentRows() {
  const rowsEl = document.getElementById("payment-rows");
  const emptyEl = document.getElementById("payments-empty");
  const prevBtn = document.getElementById("payments-prev-page");
  const nextBtn = document.getElementById("payments-next-page");

  if (allPendingPayments.length === 0) {
    rowsEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="admin-empty">Nothing pending.</div>`;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(allPendingPayments.length / PAGE_SIZE));
  paymentsPage = Math.min(paymentsPage, totalPages);
  const start = (paymentsPage - 1) * PAGE_SIZE;
  const pageItems = allPendingPayments.slice(start, start + PAGE_SIZE);

  emptyEl.innerHTML = "";
  rowsEl.innerHTML = pageItems.map(row => `
    <tr data-submission-id="${row.id}">
      <td>${escapeHtml(row.in_game_name)}</td>
      <td>${targetLabel(row)}</td>
      <td class="num">${money(row.amount_claimed)}</td>
      <td class="num">${escapeHtml(row.gcash_ref)}</td>
      <td>${row.screenshot_url ? `<button type="button" class="btn-small" data-view-screenshot="${escapeHtml(row.screenshot_url)}">View</button>` : "—"}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn-small btn-approve" data-approve-payment="${row.id}">Approve</button>
          <button type="button" class="btn-small btn-reject" data-reject-payment="${row.id}">Reject</button>
        </div>
      </td>
    </tr>
  `).join("");

  rowsEl.querySelectorAll("[data-view-screenshot]").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Loading…";
      const { data, error: signError } = await supabaseClient.storage
        .from("payment-screenshots")
        .createSignedUrl(btn.dataset.viewScreenshot, 60); // valid 60s — just long enough to open the tab
      btn.disabled = false;
      btn.textContent = "View";
      if (signError) {
        document.getElementById("payments-error").textContent = "Couldn't load screenshot: " + signError.message;
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener");
    });
  });

  rowsEl.querySelectorAll("[data-approve-payment]").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const { error: approveError } = await supabaseClient.rpc("admin_approve_payment", {
        p_submission_id: btn.dataset.approvePayment,
      });
      if (approveError) {
        document.getElementById("payments-error").textContent = approveError.message;
        btn.disabled = false;
        return;
      }
      loadPendingPayments();
    });
  });

  rowsEl.querySelectorAll("[data-reject-payment]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const reason = prompt("Reason for rejecting this payment?");
      if (reason === null) return; // cancelled
      if (!reason.trim()) {
        document.getElementById("payments-error").textContent = "Enter a reason so the member knows what to fix.";
        return;
      }

      btn.disabled = true;
      const { error: rejectError } = await supabaseClient.rpc("admin_reject_payment", {
        p_submission_id: btn.dataset.rejectPayment,
        p_reason: reason.trim(),
      });
      if (rejectError) {
        document.getElementById("payments-error").textContent = rejectError.message;
        btn.disabled = false;
        return;
      }
      loadPendingPayments();
    });
  });

  prevBtn.disabled = paymentsPage <= 1;
  nextBtn.disabled = paymentsPage >= totalPages;
}

async function loadPendingPayments() {
  const { data, error } = await supabaseClient.rpc("admin_list_payment_submissions", { p_status: "pending" });

  if (error) {
    document.getElementById("payments-error").textContent = error.message;
    return;
  }

  allPendingPayments = data || [];
  renderPaymentRows();
}

// ---------- leave requests ----------

let allPendingLeaveRequests = [];
let leavePage = 1;

function renderLeaveRows() {
  const rowsEl = document.getElementById("leave-rows");
  const emptyEl = document.getElementById("leave-empty");
  const prevBtn = document.getElementById("leave-prev-page");
  const nextBtn = document.getElementById("leave-next-page");

  if (allPendingLeaveRequests.length === 0) {
    rowsEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="admin-empty">Nothing pending.</div>`;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(allPendingLeaveRequests.length / PAGE_SIZE));
  leavePage = Math.min(leavePage, totalPages);
  const start = (leavePage - 1) * PAGE_SIZE;
  const pageItems = allPendingLeaveRequests.slice(start, start + PAGE_SIZE);

  emptyEl.innerHTML = "";
  rowsEl.innerHTML = pageItems.map(row => `
    <tr data-request-id="${row.id}">
      <td>${escapeHtml(row.in_game_name)}</td>
      <td><span class="status-badge status-badge--${row.requested_status}">${row.requested_status}</span></td>
      <td>${formatDate(row.requested_at)}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn-small btn-approve" data-approve-leave="${row.id}" data-requested-status="${row.requested_status}">Approve</button>
          <button type="button" class="btn-small btn-reject" data-deny-leave="${row.id}">Deny</button>
        </div>
      </td>
    </tr>
  `).join("");

  rowsEl.querySelectorAll("[data-approve-leave]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const requestedStatus = btn.dataset.requestedStatus;
      if (!confirm(`Approve this request? The member's status will change to "${requestedStatus}" immediately.`)) return;
      btn.disabled = true;
      const { error: approveError } = await supabaseClient.rpc("admin_approve_leave_request", {
        p_request_id: btn.dataset.approveLeave,
      });
      if (approveError) {
        document.getElementById("leave-error").textContent = approveError.message;
        btn.disabled = false;
        return;
      }
      loadPendingLeaveRequests();
    });
  });

  rowsEl.querySelectorAll("[data-deny-leave]").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const { error: denyError } = await supabaseClient.rpc("admin_deny_leave_request", {
        p_request_id: btn.dataset.denyLeave,
      });
      if (denyError) {
        document.getElementById("leave-error").textContent = denyError.message;
        btn.disabled = false;
        return;
      }
      loadPendingLeaveRequests();
    });
  });

  prevBtn.disabled = leavePage <= 1;
  nextBtn.disabled = leavePage >= totalPages;
}

async function loadPendingLeaveRequests() {
  const { data, error } = await supabaseClient.rpc("admin_list_leave_requests", { p_status: "pending" });

  if (error) {
    document.getElementById("leave-error").textContent = error.message;
    return;
  }

  allPendingLeaveRequests = data || [];
  renderLeaveRows();
}

function loadNotifications() {
  loadPendingPayments();
  loadPendingLeaveRequests();

  document.getElementById("payments-prev-page").addEventListener("click", () => {
    paymentsPage -= 1;
    renderPaymentRows();
  });
  document.getElementById("payments-next-page").addEventListener("click", () => {
    paymentsPage += 1;
    renderPaymentRows();
  });
  document.getElementById("leave-prev-page").addEventListener("click", () => {
    leavePage -= 1;
    renderLeaveRows();
  });
  document.getElementById("leave-next-page").addEventListener("click", () => {
    leavePage += 1;
    renderLeaveRows();
  });
}
