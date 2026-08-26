/*
  MANAGE-CONTRIBUTIONS.JS
  --------------------------------------------------------
  Five independent pieces on this page:

  - Payment settings: the GCash name/number shown to members on
    the payment page — a single row in site_settings, direct table
    access (protected by the admin-only UPDATE policy in
    database/06_payment_submissions.sql). The QR image uploads to
    the public "site-assets" Storage bucket (see
    database/07_site_assets.sql) at a fixed path, so re-uploading
    replaces the old one — a "?t=" cache-buster gets stored
    alongside the URL so browsers don't keep showing the stale one.

  - Shop pricing: VIP/MVP/Legacy Pass prices, also in site_settings
    (database/11_shop_core.sql) — shown to members on the payment
    page, editable here so a price change doesn't need a deploy.

  - This month's goal: admin_get_or_create_open_period() always
    hands back a usable open period (creating this calendar
    month's if none exists — bootstraps the very first period on
    a fresh site). The goal's "total" is never stored directly;
    it's just the sum of this period's expenses, computed here in
    JS from the same rows shown in the table. Adding/deleting
    expenses goes straight through Supabase (protected by the
    admin-only RLS policies in 04_admin_dashboard.sql) since
    nothing here is encrypted.

  - Side goals: same idea, direct table access. Progress per goal
    comes from side_goal_progress() — a public aggregate function
    (sums approved payments, never exposes individual rows) that
    members will eventually use too for the homepage progress bars.

  - Finalize: admin_finalize_period() does the real work server-
    side (lock expenses, compute the split, open next month with
    the surplus carried in) — this file just calls it and reloads.
    It's safe to call again on an already-finalized period, which
    is how "re-editing" a finalized month works: open it via the
    ?period=<id> link on a past-periods row (see loadPastPeriods),
    edit its expenses like normal, then finalize again to
    recompute. Without ?period in the URL, this page defaults to
    whatever period is currently open.

  Three lists on this page (expenses, side goals, past periods)
  each page 10 at a time, same pattern as everywhere else on the
  site — a busy month's expenses, or a couple years of finalized
  periods, can both pass 10 easily.
  --------------------------------------------------------
*/

const PAGE_SIZE = 10;

// money()/monthLabel()/escapeHtml() come from /utils.js, loaded
// before this file.

// ---------- payment settings ----------

function renderQrPreview(url) {
  const previewEl = document.getElementById("gcash-qr-preview");
  const removeBtn = document.getElementById("remove-qr-btn");

  if (url) {
    previewEl.src = url;
    previewEl.hidden = false;
    removeBtn.hidden = false;
  } else {
    previewEl.src = "";
    previewEl.hidden = true;
    removeBtn.hidden = true;
  }
}

async function loadPaymentSettings() {
  const { data, error } = await supabaseClient
    .from("site_settings")
    .select("gcash_name, gcash_number, gcash_qr_url, vip_price, mvp_price, battlepass_price")
    .eq("id", 1)
    .single();

  if (error) {
    document.getElementById("settings-error").textContent = "Couldn't load payment settings: " + error.message;
    return;
  }

  document.getElementById("gcash-name").value = data.gcash_name || "";
  document.getElementById("gcash-number").value = data.gcash_number || "";
  renderQrPreview(data.gcash_qr_url);

  document.getElementById("vip-price").value = data.vip_price;
  document.getElementById("mvp-price").value = data.mvp_price;
  document.getElementById("battlepass-price").value = data.battlepass_price;

  document.getElementById("save-settings-btn").addEventListener("click", async () => {
    const errorEl = document.getElementById("settings-error");
    errorEl.textContent = "";

    const { error: updateError } = await supabaseClient
      .from("site_settings")
      .update({
        gcash_name: document.getElementById("gcash-name").value.trim() || null,
        gcash_number: document.getElementById("gcash-number").value.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (updateError) {
      errorEl.textContent = updateError.message;
    }
  });

  document.getElementById("save-shop-prices-btn").addEventListener("click", async () => {
    const errorEl = document.getElementById("shop-prices-error");
    const successEl = document.getElementById("shop-prices-success");
    errorEl.textContent = "";
    successEl.textContent = "";

    const vipPrice = parseFloat(document.getElementById("vip-price").value);
    const mvpPrice = parseFloat(document.getElementById("mvp-price").value);
    const battlepassPrice = parseFloat(document.getElementById("battlepass-price").value);

    if (!(vipPrice >= 0) || !(mvpPrice >= 0) || !(battlepassPrice >= 0)) {
      errorEl.textContent = "Enter a valid price (0 or more) for all three.";
      return;
    }

    const { error: updateError } = await supabaseClient
      .from("site_settings")
      .update({
        vip_price: vipPrice,
        mvp_price: mvpPrice,
        battlepass_price: battlepassPrice,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (updateError) {
      errorEl.textContent = updateError.message;
      return;
    }

    successEl.textContent = "Prices updated.";
  });

  // Uploading a file replaces the QR immediately — its own save
  // action, separate from the name/number button above, since
  // picking a file is already a deliberate action.
  document.getElementById("gcash-qr-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const qrError = document.getElementById("qr-error");
    const qrSuccess = document.getElementById("qr-success");
    qrError.textContent = "";
    qrSuccess.textContent = "";

    // Fixed path so re-uploading replaces the old one instead of
    // piling up orphaned files. Explicitly deleting first and then
    // doing a plain (non-upsert) upload instead of upload(...,
    // {upsert:true}) — upsert makes the client check for an
    // existing file first, and that check was tripping the RLS
    // policy in a way a plain insert doesn't. Ignoring the delete's
    // result on purpose: it's expected to "fail" (nothing to
    // delete) on the very first upload.
    // A "?t=" cache-buster gets stored in the URL so browsers
    // (including the payment page members are looking at) don't
    // keep showing a stale cached image after a re-upload.
    const path = "gcash-qr";
    await supabaseClient.storage.from("site-assets").remove([path]);
    const { error: uploadError } = await supabaseClient.storage
      .from("site-assets")
      .upload(path, file);

    if (uploadError) {
      qrError.textContent = "Couldn't upload: " + uploadError.message;
      e.target.value = "";
      return;
    }

    const { data: publicUrlData } = supabaseClient.storage.from("site-assets").getPublicUrl(path);
    const bustedUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

    const { error: updateError } = await supabaseClient
      .from("site_settings")
      .update({ gcash_qr_url: bustedUrl, updated_at: new Date().toISOString() })
      .eq("id", 1);

    e.target.value = "";

    if (updateError) {
      qrError.textContent = updateError.message;
      return;
    }

    renderQrPreview(bustedUrl);
    qrSuccess.textContent = "QR code updated.";
  });

  document.getElementById("remove-qr-btn").addEventListener("click", async () => {
    const qrError = document.getElementById("qr-error");
    qrError.textContent = "";

    const { error: updateError } = await supabaseClient
      .from("site_settings")
      .update({ gcash_qr_url: null, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (updateError) {
      qrError.textContent = updateError.message;
      return;
    }

    renderQrPreview(null);
  });
}

let currentPeriod = null;

async function loadManageContributions() {
  loadPaymentSettings();

  const requestedId = new URLSearchParams(window.location.search).get("period");

  // Arriving via the "Edit" link on a Past periods row should land
  // straight on the tab that link is actually about, not the
  // default first tab — see activateAdminTab() in admin-tabs.js.
  if (requestedId) activateAdminTab("goal");

  const { data: period, error: periodError } = requestedId
    ? await supabaseClient.from("periods").select("*").eq("id", requestedId).single()
    : await supabaseClient.rpc("admin_get_or_create_open_period");

  if (periodError || !period) {
    document.getElementById("period-heading").textContent = "Couldn't load this period";
    document.getElementById("expense-error").textContent = periodError ? periodError.message : "Unknown error.";
    return;
  }

  currentPeriod = period;

  const badge = `<span class="status-badge status-badge--${period.status}">${period.status}</span>`;
  document.getElementById("period-heading").innerHTML =
    `This month's goal — ${monthLabel(period.month)} ${badge}`;
  document.getElementById("goal-title").value = period.title || "";

  const backLinkEl = document.getElementById("back-to-current");
  backLinkEl.innerHTML = requestedId
    ? `<a href="/admin/manage-contributions">← Back to the current period</a>`
    : "";

  const finalizeBtn = document.getElementById("finalize-btn");
  finalizeBtn.textContent = period.status === "finalized" ? "Re-finalize (recompute totals)" : "Finalize this period";

  await Promise.all([loadExpenses(), loadSideGoals(), loadPastPeriods()]);
  wireEvents();
}

// ---------- expenses ----------

let allExpenses = [];
let expensePage = 1;

function renderExpenses() {
  const rowsEl = document.getElementById("expense-rows");
  const emptyEl = document.getElementById("expense-empty");
  const prevBtn = document.getElementById("expense-prev-page");
  const nextBtn = document.getElementById("expense-next-page");

  const total = allExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  document.getElementById("expense-total").textContent = money(total);

  if (allExpenses.length === 0) {
    rowsEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="admin-empty">No expenses logged yet this period.</div>`;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(allExpenses.length / PAGE_SIZE));
  expensePage = Math.min(expensePage, totalPages);
  const start = (expensePage - 1) * PAGE_SIZE;
  const pageItems = allExpenses.slice(start, start + PAGE_SIZE);

  emptyEl.innerHTML = "";
  rowsEl.innerHTML = pageItems.map(e => `
    <tr>
      <td>${escapeHtml(e.category)}</td>
      <td class="num">${money(e.amount)}</td>
      <td><button type="button" class="btn-small btn-reject" data-expense-id="${e.id}">Remove</button></td>
    </tr>
  `).join("");

  rowsEl.querySelectorAll("[data-expense-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const { error: deleteError } = await supabaseClient.from("expenses").delete().eq("id", btn.dataset.expenseId);
      if (deleteError) {
        document.getElementById("expense-error").textContent = deleteError.message;
        btn.disabled = false;
        return;
      }
      loadExpenses();
    });
  });

  prevBtn.disabled = expensePage <= 1;
  nextBtn.disabled = expensePage >= totalPages;
}

async function loadExpenses() {
  const { data, error } = await supabaseClient
    .from("expenses")
    .select("id, category, amount")
    .eq("period_id", currentPeriod.id)
    .order("created_at", { ascending: true });

  if (error) {
    document.getElementById("expense-empty").innerHTML = `<div class="admin-empty">Couldn't load expenses: ${error.message}</div>`;
    document.getElementById("expense-rows").innerHTML = "";
    return;
  }

  allExpenses = data || [];
  renderExpenses();
}

// ---------- side goals ----------

let allSideGoals = [];
let sideGoalPage = 1;

async function renderSideGoals() {
  const rowsEl = document.getElementById("side-goal-rows");
  const emptyEl = document.getElementById("side-goal-empty");
  const prevBtn = document.getElementById("side-goal-prev-page");
  const nextBtn = document.getElementById("side-goal-next-page");

  if (allSideGoals.length === 0) {
    rowsEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="admin-empty">No side goals yet.</div>`;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(allSideGoals.length / PAGE_SIZE));
  sideGoalPage = Math.min(sideGoalPage, totalPages);
  const start = (sideGoalPage - 1) * PAGE_SIZE;
  const pageItems = allSideGoals.slice(start, start + PAGE_SIZE);

  emptyEl.innerHTML = "";

  const progressResults = await Promise.all(
    pageItems.map(g => supabaseClient.rpc("side_goal_progress", { p_side_goal_id: g.id }))
  );

  rowsEl.innerHTML = pageItems.map((g, i) => `
    <tr>
      <td>${escapeHtml(g.title)}</td>
      <td class="num">${money(progressResults[i].data || 0)} / ${money(g.target)}</td>
      <td><span class="status-badge status-badge--${g.status}">${g.status}</span></td>
      <td>
        ${g.status === "active"
          ? `<button type="button" class="btn-small" data-complete-id="${g.id}">Mark completed</button>`
          : ""}
      </td>
    </tr>
  `).join("");

  rowsEl.querySelectorAll("[data-complete-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const { error: updateError } = await supabaseClient
        .from("side_goals")
        .update({ status: "completed" })
        .eq("id", btn.dataset.completeId);
      if (updateError) {
        document.getElementById("side-goal-error").textContent = updateError.message;
        btn.disabled = false;
        return;
      }
      loadSideGoals();
    });
  });

  prevBtn.disabled = sideGoalPage <= 1;
  nextBtn.disabled = sideGoalPage >= totalPages;
}

async function loadSideGoals() {
  const { data, error } = await supabaseClient
    .from("side_goals")
    .select("id, title, target, status")
    .order("created_at", { ascending: false });

  if (error) {
    document.getElementById("side-goal-empty").innerHTML = `<div class="admin-empty">Couldn't load side goals: ${error.message}</div>`;
    document.getElementById("side-goal-rows").innerHTML = "";
    return;
  }

  allSideGoals = data || [];
  await renderSideGoals();
}

// ---------- past periods ----------

let allPastPeriods = [];
let pastPeriodPage = 1;

function renderPastPeriods() {
  const rowsEl = document.getElementById("past-period-rows");
  const emptyEl = document.getElementById("past-period-empty");
  const prevBtn = document.getElementById("past-period-prev-page");
  const nextBtn = document.getElementById("past-period-next-page");

  if (allPastPeriods.length === 0) {
    rowsEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="admin-empty">No periods finalized yet.</div>`;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(allPastPeriods.length / PAGE_SIZE));
  pastPeriodPage = Math.min(pastPeriodPage, totalPages);
  const start = (pastPeriodPage - 1) * PAGE_SIZE;
  const pageItems = allPastPeriods.slice(start, start + PAGE_SIZE);

  emptyEl.innerHTML = "";
  rowsEl.innerHTML = pageItems.map(p => `
    <tr>
      <td>${monthLabel(p.month)}</td>
      <td>${escapeHtml(p.title) || "—"}</td>
      <td class="num">${money(p.total_expenses)}</td>
      <td class="num">${money(p.amount_due_per_member)}</td>
      <td class="num">${money(p.surplus_carried_out)}</td>
      <td><a href="/admin/manage-contributions?period=${p.id}">Edit</a></td>
    </tr>
  `).join("");

  prevBtn.disabled = pastPeriodPage <= 1;
  nextBtn.disabled = pastPeriodPage >= totalPages;
}

async function loadPastPeriods() {
  const { data, error } = await supabaseClient
    .from("periods")
    .select("id, month, title, total_expenses, amount_due_per_member, surplus_carried_out")
    .eq("status", "finalized")
    .order("month", { ascending: false });

  if (error) {
    document.getElementById("past-period-empty").innerHTML = `<div class="admin-empty">Couldn't load past periods: ${error.message}</div>`;
    return;
  }

  allPastPeriods = data || [];
  renderPastPeriods();
}

// ---------- form wiring (only needs to happen once) ----------

let eventsWired = false;

function wireEvents() {
  if (eventsWired) return;
  eventsWired = true;

  document.getElementById("expense-prev-page").addEventListener("click", () => {
    expensePage -= 1;
    renderExpenses();
  });
  document.getElementById("expense-next-page").addEventListener("click", () => {
    expensePage += 1;
    renderExpenses();
  });
  document.getElementById("side-goal-prev-page").addEventListener("click", () => {
    sideGoalPage -= 1;
    renderSideGoals();
  });
  document.getElementById("side-goal-next-page").addEventListener("click", () => {
    sideGoalPage += 1;
    renderSideGoals();
  });
  document.getElementById("past-period-prev-page").addEventListener("click", () => {
    pastPeriodPage -= 1;
    renderPastPeriods();
  });
  document.getElementById("past-period-next-page").addEventListener("click", () => {
    pastPeriodPage += 1;
    renderPastPeriods();
  });

  document.getElementById("save-title-btn").addEventListener("click", async () => {
    const title = document.getElementById("goal-title").value.trim();
    const { error } = await supabaseClient.from("periods").update({ title }).eq("id", currentPeriod.id);
    if (error) {
      document.getElementById("expense-error").textContent = error.message;
    } else {
      currentPeriod.title = title;
      document.getElementById("expense-error").textContent = "";
    }
  });

  document.getElementById("expense-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("expense-error");
    errorEl.textContent = "";

    const category = document.getElementById("expense-for").value.trim();
    const amount = parseFloat(document.getElementById("expense-amount").value);

    if (!category || !amount || amount <= 0) {
      errorEl.textContent = "Enter what it's for and an amount greater than 0.";
      return;
    }

    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient.from("expenses").insert({
      period_id: currentPeriod.id,
      category,
      amount,
      created_by: user.id,
    });

    if (error) {
      errorEl.textContent = error.message;
      return;
    }

    document.getElementById("expense-form").reset();
    loadExpenses();
  });

  document.getElementById("side-goal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("side-goal-error");
    errorEl.textContent = "";

    const title = document.getElementById("side-goal-title").value.trim();
    const target = parseFloat(document.getElementById("side-goal-target").value);

    if (!title || !target || target <= 0) {
      errorEl.textContent = "Enter a name and a target greater than 0.";
      return;
    }

    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient.from("side_goals").insert({
      title,
      target,
      created_by: user.id,
    });

    if (error) {
      errorEl.textContent = error.message;
      return;
    }

    document.getElementById("side-goal-form").reset();
    loadSideGoals();
  });

  document.getElementById("finalize-btn").addEventListener("click", async () => {
    const finalizeError = document.getElementById("finalize-error");
    finalizeError.textContent = "";

    const monthText = monthLabel(currentPeriod.month);
    const alreadyFinalized = currentPeriod.status === "finalized";
    const confirmMessage = alreadyFinalized
      ? `Re-finalize ${monthText}? This recomputes the total and split from the current expenses.`
      : `Finalize ${monthText}? This locks the expenses and opens next month.`;
    if (!confirm(confirmMessage)) return;

    const btn = document.getElementById("finalize-btn");
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = alreadyFinalized ? "Recomputing…" : "Finalizing…";

    const { error } = await supabaseClient.rpc("admin_finalize_period", { p_period_id: currentPeriod.id });

    btn.disabled = false;
    btn.textContent = originalLabel;

    if (error) {
      finalizeError.textContent = error.message;
      return;
    }

    // Whether this was a first-time finalize or a re-finalize of a
    // past period reached via the Edit link (?period=<id> in the
    // URL), head back to the current open period afterward rather
    // than staying parked on the one just closed out.
    window.location.href = "/admin/manage-contributions";
  });
}
