/*
  ADMIN-CONTRIBUTIONS.JS
  --------------------------------------------------------
  Two independent lists on this page:

  - Live submissions: every payment submission made through the
    app, fetched via admin_list_payment_submissions() (needs to
    decrypt each GCash reference, so it's a database function
    rather than a plain select). Editable/deletable, and a manual
    entry can be added, via admin_create_payment()/
    admin_update_payment()/admin_delete_payment() — for a member
    who paid outside the site entirely (cash, bank transfer, GCash
    sent straight to the admin) and so never went through the
    payment page. A manual entry gets inserted already 'approved'
    (no review needed — the admin IS the reviewer) with no GCash
    ref/screenshot (there isn't one); editing an entry never touches
    those fields either way, so a real member-submitted proof always
    stays exactly as it was even if its amount/target gets corrected
    later. See database/21_admin_payment_management.sql.

  - Historical: legacy_contributions — real contributions from
    before this site existed (see
    database/05_legacy_contributions.sql), plain select/insert/
    update/delete since nothing there is encrypted or sensitive
    (protected by the admin-only RLS policies in that file). Not
    tied to a member account at all, unlike Live submissions —
    that's the real difference between the two, not just "old vs
    new."

  Filtering happens client-side against each fetched list — this
  site isn't going to have thousands of rows in either, so there's
  no need for server-side pagination or search. Both tables page
  their filtered results 10 at a time (same PAGE_SIZE/pattern as
  the member-facing ledger) — each table tracks its own current
  page independently.
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

// Everything a submission actually covers — dues/side-goal target
// plus whatever shop items came with it — as one glanceable list,
// same breakdown the public ledger already shows via its tags (see
// ledger.js). Says "Dues" rather than repeating the month "For"
// already shows; a side goal gets named since that's genuinely
// different information, not a repeat of the same word.
function purposeLabel(row) {
  const parts = [];
  if (row.side_goal_title) parts.push(escapeHtml(row.side_goal_title));
  else if (row.period_month) parts.push("Dues");
  if (row.rank_purchased) parts.push(row.rank_purchased.toUpperCase());
  if (row.battlepass_purchased) parts.push("Legacy Pass");
  return parts.length > 0 ? parts.join(", ") : "—";
}

let allSubmissions = [];
let submissionsPage = 1;

function renderRows() {
  const status = document.getElementById("status-filter").value;
  const needle = document.getElementById("name-filter").value.trim().toLowerCase();

  const filtered = allSubmissions.filter(row => {
    if (status && row.status !== status) return false;
    if (needle && !row.in_game_name.toLowerCase().includes(needle)) return false;
    return true;
  });

  const rowsEl = document.getElementById("contributions-rows");
  const emptyEl = document.getElementById("contributions-empty");
  const prevBtn = document.getElementById("contributions-prev-page");
  const nextBtn = document.getElementById("contributions-next-page");

  if (filtered.length === 0) {
    rowsEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="admin-empty">No submissions match.</div>`;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  submissionsPage = Math.max(1, Math.min(submissionsPage, totalPages));
  const start = (submissionsPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  emptyEl.innerHTML = "";
  rowsEl.innerHTML = pageItems.map(row => `
    <tr>
      <td>${escapeHtml(row.in_game_name)}</td>
      <td>${targetLabel(row)}</td>
      <td>${purposeLabel(row)}</td>
      <td class="num">${money(row.amount_claimed)}</td>
      <td><span class="status-badge status-badge--${row.status}">${row.status}</span></td>
      <td>${formatDate(row.submitted_at)}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn-small" data-edit-payment="${row.id}">Edit</button>
          <button type="button" class="btn-small btn-reject" data-delete-payment="${row.id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");

  rowsEl.querySelectorAll("[data-edit-payment]").forEach(btn => {
    btn.addEventListener("click", () => {
      const row = allSubmissions.find(r => r.id === btn.dataset.editPayment);
      if (row) openManualPaymentForm(row);
    });
  });

  rowsEl.querySelectorAll("[data-delete-payment]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this submission? This can't be undone.")) return;
      btn.disabled = true;
      const { error } = await supabaseClient.rpc("admin_delete_payment", {
        p_submission_id: btn.dataset.deletePayment,
      });
      if (error) {
        document.getElementById("manual-payment-error").textContent = error.message;
        btn.disabled = false;
        return;
      }
      loadContributions();
    });
  });

  prevBtn.disabled = submissionsPage <= 1;
  nextBtn.disabled = submissionsPage >= totalPages;
}

// ---------- manual entries (add/edit a Live submissions row) ----------

let allProfiles = [];
let allPeriods = [];
let allSideGoals = [];

// Populates the member/target pickers once — profiles/periods/side
// goals don't change just from adding a payment, so this doesn't
// need to re-run every time loadContributions() does. Target options
// are encoded "period:<id>" / "sidegoal:<id>", same convention as
// pay.js's own target picker, except here the admin can target ANY
// period or side goal (not just the currently-open/active one) —
// backfilling a payment from a past, already-finalized month is
// exactly the kind of thing this feature exists for.
async function loadManualPaymentFormOptions() {
  const [{ data: profiles }, { data: periods }, { data: sideGoals }] = await Promise.all([
    supabaseClient.rpc("admin_list_profiles"),
    supabaseClient.from("periods").select("id, month, status").order("month", { ascending: false }),
    supabaseClient.from("side_goals").select("id, title, status").order("created_at", { ascending: false }),
  ]);

  allProfiles = (profiles || []).slice().sort((a, b) => a.in_game_name.localeCompare(b.in_game_name));
  allPeriods = periods || [];
  allSideGoals = sideGoals || [];

  document.getElementById("manual-payment-user").innerHTML = allProfiles
    .map(p => `<option value="${p.id}">${escapeHtml(p.in_game_name)}</option>`)
    .join("");

  const periodOptions = allPeriods
    .map(p => `<option value="period:${p.id}">${escapeHtml(monthLabel(p.month))} (${p.status})</option>`)
    .join("");
  const sideGoalOptions = allSideGoals
    .map(g => `<option value="sidegoal:${g.id}">${escapeHtml(g.title)} (${g.status})</option>`)
    .join("");
  document.getElementById("manual-payment-target").innerHTML = `
    <option value="">None — shop purchase only</option>
    ${periodOptions ? `<optgroup label="Dues">${periodOptions}</optgroup>` : ""}
    ${sideGoalOptions ? `<optgroup label="Side goals">${sideGoalOptions}</optgroup>` : ""}
  `;
}

function resetManualPaymentForm() {
  document.getElementById("manual-payment-id").value = "";
  document.getElementById("manual-payment-target").value = "";
  document.getElementById("manual-payment-rank").value = "";
  document.getElementById("manual-payment-amount").value = "";
  document.getElementById("manual-payment-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("manual-payment-battlepass").value = "";
  document.getElementById("manual-payment-submit-btn").textContent = "Add entry";
}

// Opens the form pre-filled with an existing row's values — used by
// the Edit button. resetManualPaymentForm() covers the "Add" case;
// this covers "Edit" by overwriting the same fields afterward.
function openManualPaymentForm(row) {
  resetManualPaymentForm();

  document.getElementById("manual-payment-form").hidden = false;
  document.getElementById("manual-payment-error").textContent = "";

  document.getElementById("manual-payment-id").value = row.id;
  document.getElementById("manual-payment-user").value = row.user_id;
  document.getElementById("manual-payment-target").value = row.period_id
    ? `period:${row.period_id}`
    : row.side_goal_id
      ? `sidegoal:${row.side_goal_id}`
      : "";
  document.getElementById("manual-payment-rank").value = row.rank_purchased || "";
  document.getElementById("manual-payment-amount").value = row.amount_claimed;
  document.getElementById("manual-payment-date").value = new Date(row.submitted_at).toISOString().slice(0, 10);
  document.getElementById("manual-payment-battlepass").value = row.battlepass_purchased ? "yes" : "";
  document.getElementById("manual-payment-submit-btn").textContent = "Save changes";

  document.getElementById("manual-payment-form").scrollIntoView({ behavior: "smooth", block: "center" });
}

// Wired once (not on every loadContributions() call, which now also
// runs after a manual add/edit/delete to refresh the table — without
// this guard, listeners on the filter/pagination controls would
// stack up a little more each time).
let eventsWired = false;

function wireContributionsEvents() {
  if (eventsWired) return;
  eventsWired = true;

  document.getElementById("status-filter").addEventListener("change", () => {
    submissionsPage = 1;
    renderRows();
  });
  document.getElementById("name-filter").addEventListener("input", () => {
    submissionsPage = 1;
    renderRows();
  });
  document.getElementById("contributions-prev-page").addEventListener("click", () => {
    submissionsPage -= 1;
    renderRows();
  });
  document.getElementById("contributions-next-page").addEventListener("click", () => {
    submissionsPage += 1;
    renderRows();
  });

  document.getElementById("manual-payment-toggle-btn").addEventListener("click", () => {
    const form = document.getElementById("manual-payment-form");
    if (form.hidden) {
      resetManualPaymentForm();
      form.hidden = false;
    } else {
      form.hidden = true;
    }
  });

  document.getElementById("manual-payment-cancel-btn").addEventListener("click", () => {
    document.getElementById("manual-payment-form").hidden = true;
    document.getElementById("manual-payment-error").textContent = "";
  });

  document.getElementById("manual-payment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("manual-payment-error");
    errorEl.textContent = "";

    const id = document.getElementById("manual-payment-id").value;
    const userId = document.getElementById("manual-payment-user").value;
    const targetValue = document.getElementById("manual-payment-target").value;
    const rank = document.getElementById("manual-payment-rank").value;
    const amount = parseFloat(document.getElementById("manual-payment-amount").value);
    const date = document.getElementById("manual-payment-date").value;
    const battlepass = document.getElementById("manual-payment-battlepass").value === "yes";

    if (!userId) {
      errorEl.textContent = "Choose a member.";
      return;
    }
    if (!amount || amount <= 0) {
      errorEl.textContent = "Enter an amount greater than 0.";
      return;
    }
    if (!date) {
      errorEl.textContent = "Enter the date this payment happened.";
      return;
    }

    const params = {
      p_user_id: userId,
      p_amount: amount,
      p_contributed_on: date,
      p_period_id: null,
      p_side_goal_id: null,
      p_rank_purchased: rank || null,
      p_battlepass_purchased: battlepass,
    };
    if (targetValue.startsWith("period:")) {
      params.p_period_id = targetValue.split(":")[1];
    } else if (targetValue.startsWith("sidegoal:")) {
      params.p_side_goal_id = targetValue.split(":")[1];
    }

    const submitBtn = document.getElementById("manual-payment-submit-btn");
    submitBtn.disabled = true;

    const { error } = id
      ? await supabaseClient.rpc("admin_update_payment", { ...params, p_submission_id: id })
      : await supabaseClient.rpc("admin_create_payment", params);

    submitBtn.disabled = false;

    if (error) {
      errorEl.textContent = error.message;
      return;
    }

    document.getElementById("manual-payment-form").hidden = true;
    loadContributions();
  });
}

async function loadContributions() {
  const { data, error } = await supabaseClient.rpc("admin_list_payment_submissions");

  if (error) {
    document.getElementById("contributions-empty").innerHTML =
      `<div class="admin-empty">Couldn't load submissions: ${escapeHtml(error.message)}</div>`;
    return;
  }

  allSubmissions = data || [];
  document.getElementById("live-count").textContent = allSubmissions.length;
  renderRows();
  wireContributionsEvents();
}

// ---------- historical (legacy_contributions) ----------

let allLegacy = [];
let editingLegacyId = null; // id of the row currently in edit mode, if any
let legacyPage = 1;

function renderLegacyRows() {
  const needle = document.getElementById("legacy-name-filter").value.trim().toLowerCase();

  const filtered = needle
    ? allLegacy.filter(row => row.contributor_name.toLowerCase().includes(needle))
    : allLegacy;

  const rowsEl = document.getElementById("legacy-rows");
  const emptyEl = document.getElementById("legacy-empty");
  const prevBtn = document.getElementById("legacy-prev-page");
  const nextBtn = document.getElementById("legacy-next-page");

  if (filtered.length === 0) {
    rowsEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="admin-empty">No historical contributions match.</div>`;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  legacyPage = Math.max(1, Math.min(legacyPage, totalPages));
  const start = (legacyPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  emptyEl.innerHTML = "";
  rowsEl.innerHTML = pageItems.map(row => {
    if (row.id === editingLegacyId) {
      return `
        <tr>
          <td><input type="text" class="legacy-edit-name" value="${escapeHtml(row.contributor_name)}" /></td>
          <td><input type="number" class="legacy-edit-amount" min="0" step="0.01" value="${row.amount}" /></td>
          <td><input type="date" class="legacy-edit-date" value="${row.contributed_on}" /></td>
          <td>
            <div class="row-actions">
              <button type="button" class="btn-small btn-approve" data-save-legacy="${row.id}">Save</button>
              <button type="button" class="btn-small" data-cancel-legacy="${row.id}">Cancel</button>
            </div>
          </td>
        </tr>
      `;
    }
    return `
      <tr>
        <td>${escapeHtml(row.contributor_name)}</td>
        <td class="num">${money(row.amount)}</td>
        <td>${formatDate(row.contributed_on)}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn-small" data-edit-legacy="${row.id}">Edit</button>
            <button type="button" class="btn-small btn-reject" data-delete-legacy="${row.id}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  prevBtn.disabled = legacyPage <= 1;
  nextBtn.disabled = legacyPage >= totalPages;

  wireLegacyRowEvents();
}

function wireLegacyRowEvents() {
  document.querySelectorAll("[data-edit-legacy]").forEach(btn => {
    btn.addEventListener("click", () => {
      editingLegacyId = btn.dataset.editLegacy;
      renderLegacyRows();
    });
  });

  document.querySelectorAll("[data-cancel-legacy]").forEach(btn => {
    btn.addEventListener("click", () => {
      editingLegacyId = null;
      renderLegacyRows();
    });
  });

  document.querySelectorAll("[data-save-legacy]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const name = row.querySelector(".legacy-edit-name").value.trim();
      const amount = parseFloat(row.querySelector(".legacy-edit-amount").value);
      const date = row.querySelector(".legacy-edit-date").value;

      if (!name || !amount || amount <= 0 || !date) {
        alert("Enter a name, an amount greater than 0, and a date.");
        return;
      }

      btn.disabled = true;
      const { error } = await supabaseClient
        .from("legacy_contributions")
        .update({ contributor_name: name, amount, contributed_on: date })
        .eq("id", btn.dataset.saveLegacy);

      if (error) {
        alert("Couldn't save: " + error.message);
        btn.disabled = false;
        return;
      }

      editingLegacyId = null;
      loadLegacyContributions();
    });
  });

  document.querySelectorAll("[data-delete-legacy]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this historical contribution? This can't be undone.")) return;
      btn.disabled = true;
      const { error } = await supabaseClient.from("legacy_contributions").delete().eq("id", btn.dataset.deleteLegacy);
      if (error) {
        alert("Couldn't delete: " + error.message);
        btn.disabled = false;
        return;
      }
      loadLegacyContributions();
    });
  });
}

// Wired once — edit/delete/add all reload the list afterward (see
// loadLegacyContributions()), so without this guard these listeners
// would get re-attached on every one of those, and each stacked
// duplicate would fire Previous/Next that many times per click.
// That's exactly what let legacyPage march past 1 down to 0 or
// negative after a delete, which combined with .slice()'s handling
// of a negative start index is what made "Previous" show an empty
// list until a full page refresh reset the page counter back to 1.
let legacyEventsWired = false;

function wireLegacyEvents() {
  if (legacyEventsWired) return;
  legacyEventsWired = true;

  document.getElementById("legacy-name-filter").addEventListener("input", () => {
    legacyPage = 1;
    renderLegacyRows();
  });
  document.getElementById("legacy-prev-page").addEventListener("click", () => {
    legacyPage -= 1;
    renderLegacyRows();
  });
  document.getElementById("legacy-next-page").addEventListener("click", () => {
    legacyPage += 1;
    renderLegacyRows();
  });

  document.getElementById("legacy-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("legacy-add-error");
    errorEl.textContent = "";

    const name = document.getElementById("legacy-add-name").value.trim();
    const amount = parseFloat(document.getElementById("legacy-add-amount").value);
    const date = document.getElementById("legacy-add-date").value;

    if (!name || !amount || amount <= 0 || !date) {
      errorEl.textContent = "Enter a name, an amount greater than 0, and a date.";
      return;
    }

    const { error } = await supabaseClient.from("legacy_contributions").insert({
      contributor_name: name,
      amount,
      contributed_on: date,
    });

    if (error) {
      errorEl.textContent = error.message;
      return;
    }

    document.getElementById("legacy-add-form").reset();
    loadLegacyContributions();
  });
}

async function loadLegacyContributions() {
  const { data, error } = await supabaseClient
    .from("legacy_contributions")
    .select("id, contributor_name, amount, contributed_on")
    .order("contributed_on", { ascending: false });

  if (error) {
    document.getElementById("legacy-empty").innerHTML =
      `<div class="admin-empty">Couldn't load historical contributions: ${escapeHtml(error.message)}</div>`;
    return;
  }

  allLegacy = data || [];
  document.getElementById("legacy-count").textContent = allLegacy.length;
  renderLegacyRows();
  wireLegacyEvents();
}
