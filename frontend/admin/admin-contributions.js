/*
  ADMIN-CONTRIBUTIONS.JS
  --------------------------------------------------------
  Two independent, read-only lists on this page:

  - Live submissions: every payment submission made through the
    app, fetched via admin_list_payment_submissions() (needs to
    decrypt each GCash reference, so it's a database function
    rather than a plain select).

  - Historical: legacy_contributions — real contributions from
    before this site existed (see
    database/05_legacy_contributions.sql), plain select/insert/
    update/delete since nothing there is encrypted or sensitive
    (protected by the admin-only RLS policies in that file — this
    section, unlike Live submissions, is actually editable: add
    new rows, or click Edit on one to fix a transcription mistake
    like the "Akispade1209" amount flagged when this was first
    imported).

  Filtering happens client-side against each fetched list — this
  site isn't going to have thousands of rows in either, so there's
  no need for server-side pagination or search.
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
  if (row.side_goal_title) return row.side_goal_title;
  if (row.period_month) {
    const d = new Date(row.period_month);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  return "—";
}

let allSubmissions = [];

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

  if (filtered.length === 0) {
    rowsEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="admin-empty">No submissions match.</div>`;
    return;
  }

  emptyEl.innerHTML = "";
  rowsEl.innerHTML = filtered.map(row => `
    <tr>
      <td>${row.in_game_name}</td>
      <td>${targetLabel(row)}</td>
      <td class="num">${money(row.amount_claimed)}</td>
      <td><span class="status-badge status-badge--${row.status}">${row.status}</span></td>
      <td>${formatDate(row.submitted_at)}</td>
    </tr>
  `).join("");
}

async function loadContributions() {
  const { data, error } = await supabaseClient.rpc("admin_list_payment_submissions");

  if (error) {
    document.getElementById("contributions-empty").innerHTML =
      `<div class="admin-empty">Couldn't load submissions: ${error.message}</div>`;
    return;
  }

  allSubmissions = data || [];
  renderRows();

  document.getElementById("status-filter").addEventListener("change", renderRows);
  document.getElementById("name-filter").addEventListener("input", renderRows);
}

// ---------- historical (legacy_contributions) ----------

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

let allLegacy = [];
let editingLegacyId = null; // id of the row currently in edit mode, if any

function renderLegacyRows() {
  const needle = document.getElementById("legacy-name-filter").value.trim().toLowerCase();

  const filtered = needle
    ? allLegacy.filter(row => row.contributor_name.toLowerCase().includes(needle))
    : allLegacy;

  const rowsEl = document.getElementById("legacy-rows");
  const emptyEl = document.getElementById("legacy-empty");

  if (filtered.length === 0) {
    rowsEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="admin-empty">No historical contributions match.</div>`;
    return;
  }

  emptyEl.innerHTML = "";
  rowsEl.innerHTML = filtered.map(row => {
    if (row.id === editingLegacyId) {
      return `
        <tr>
          <td><input type="text" class="legacy-edit-name" value="${escapeAttr(row.contributor_name)}" /></td>
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
        <td>${row.contributor_name}</td>
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

async function loadLegacyContributions() {
  const { data, error } = await supabaseClient
    .from("legacy_contributions")
    .select("id, contributor_name, amount, contributed_on")
    .order("contributed_on", { ascending: false });

  if (error) {
    document.getElementById("legacy-empty").innerHTML =
      `<div class="admin-empty">Couldn't load historical contributions: ${error.message}</div>`;
    return;
  }

  allLegacy = data || [];
  renderLegacyRows();

  // Wired once — loadLegacyContributions() only ever runs on page load,
  // rows themselves get re-wired on every render (see wireLegacyRowEvents).
  document.getElementById("legacy-name-filter").addEventListener("input", renderLegacyRows);

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
