/*
  PAY.JS
  --------------------------------------------------------
  Pieces, loaded together in loadPaymentPage():

  - This month's goal: same "sum of expenses, live" idea as the
    homepage, plus a live per-member share (total ÷ active
    members) — not stored anywhere, recomputed on every load, so
    it can shift if more expenses get logged mid-month. That's a
    deliberate choice, not a bug.

  - GCash details + shop prices: both read from site_settings
    (managed in the admin's Manage Contributions page) in one call.

  - Shop selection (rank + Legacy Pass): optional add-ons on top of
    whatever "What's this for?" target is chosen. The checkout
    summary is a live, client-side estimate only — the real total
    is whatever the member actually sends and types into "Amount
    sent" (same self-report-then-admin-verifies model the site's
    always used), but the estimate pre-fills that field so most
    people never have to do the math themselves. Any discount
    credit gets applied automatically, up to what's available.

  - The submit form: uploads the screenshot to the private
    payment-screenshots Storage bucket first (path
    "‹user_id›/‹timestamp›-‹filename›", enforced by the bucket's
    RLS policies), then calls submit_payment() with that path plus
    the rank/battlepass/discount choice — that function does the
    actual encrypted insert, always as 'pending' no matter what.

  - Remaining balance: due − sum of your own approved payments for
    the current period, via the self-view RLS policy that was
    already there. Your full submission history (all periods, all
    statuses) moved to its own page — see /my-contributions,
    reachable from the profile dropdown — this page only needs the
    current period's number.
  --------------------------------------------------------
*/

// money()/formatDate()/escapeHtml() come from /utils.js, loaded
// before this file.

let currentUser = null;
let currentPeriod = null; // { id, title, expenses, total, duePerMember } or null
let shopPrices = { vip: 0, mvp: 0, battlepass: 0 };
let discountBalance = 0;
let lastAutoFilledAmount = null; // tracks whether the amount field still matches OUR last estimate, so we don't clobber a manual edit

async function loadCurrentPeriod() {
  const { data: period } = await supabaseClient
    .from("periods")
    .select("id, month, title")
    .eq("status", "open")
    .order("month", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!period) return null;

  const [{ data: expenses }, { count: activeCount }] = await Promise.all([
    supabaseClient
      .from("expenses")
      .select("category, amount")
      .eq("period_id", period.id)
      .order("created_at", { ascending: true }),
    supabaseClient.from("profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);

  const total = (expenses || []).reduce((sum, e) => sum + Number(e.amount), 0);
  const duePerMember = activeCount > 0 ? total / activeCount : 0;

  return {
    id: period.id,
    title: period.title || "This month's goal",
    expenses: expenses || [],
    total,
    duePerMember,
  };
}

function renderPeriodCard(period) {
  const headingEl = document.getElementById("period-heading");
  const subEl = document.getElementById("period-sub");
  const listEl = document.getElementById("expense-list");

  if (!period) {
    headingEl.textContent = "No active goal right now";
    subEl.textContent = "Check back once this month's expenses are logged.";
    listEl.innerHTML = "";
    return;
  }

  headingEl.textContent = period.title;
  subEl.textContent = "Here's exactly what this month's dues cover.";

  listEl.innerHTML = period.expenses.length === 0
    ? `<div class="ledger-empty">No expenses logged yet.</div>`
    : period.expenses.map(e => `
        <div class="ledger-row">
          <div class="ledger-who"><span class="ledger-name">${escapeHtml(e.category)}</span></div>
          <div class="ledger-right"><span class="ledger-amount">${money(e.amount)}</span></div>
        </div>
      `).join("");
}

function renderSummaryTiles(period, remaining) {
  const el = document.getElementById("summary-tiles");
  if (!period) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = `
    <div class="summary-tile">
      <div class="summary-tile-value">${money(period.total)}</div>
      <div class="summary-tile-label">Total goal</div>
    </div>
    <div class="summary-tile">
      <div class="summary-tile-value">${money(period.duePerMember)}</div>
      <div class="summary-tile-label">Your share (live estimate)</div>
    </div>
    <div class="summary-tile">
      <div class="summary-tile-value">${money(remaining)}</div>
      <div class="summary-tile-label">Remaining balance</div>
    </div>
  `;
}

async function loadGcashSettings() {
  const { data } = await supabaseClient
    .from("site_settings")
    .select("gcash_name, gcash_number, gcash_qr_url, vip_price, mvp_price, battlepass_price")
    .eq("id", 1)
    .single();
  return data;
}

async function loadMyDiscountBalance() {
  const { data } = await supabaseClient.rpc("get_my_profile");
  return data && data[0] ? Number(data[0].discount_credits) || 0 : 0;
}

function renderGcashDetails(settings) {
  const el = document.getElementById("gcash-details");
  const qrEl = document.getElementById("gcash-qr");

  if (!settings || (!settings.gcash_name && !settings.gcash_number)) {
    el.textContent = "Payment details haven't been set up yet — check back soon or ask an admin.";
    qrEl.hidden = true;
    return;
  }

  el.innerHTML = `Send to <strong>${escapeHtml(settings.gcash_name) || "—"}</strong> — <strong>${escapeHtml(settings.gcash_number) || "—"}</strong>`;

  if (settings.gcash_qr_url) {
    qrEl.src = settings.gcash_qr_url;
    qrEl.hidden = false;
  } else {
    qrEl.hidden = true;
  }
}

async function loadActiveSideGoals() {
  const { data } = await supabaseClient
    .from("side_goals")
    .select("id, title")
    .eq("status", "active")
    .order("created_at", { ascending: false });
  return data || [];
}

// Adds one radio option per active side goal, and hides/disables
// whichever half of the choice doesn't apply (no open period, or
// no side goals) so the form can't be submitted with nothing
// valid selected.
function renderSideGoalOptions(sideGoals, period) {
  const group = document.getElementById("payment-target-group");
  const duesOption = group.querySelector('input[value="period"]').closest(".radio-option");

  sideGoals.forEach(g => {
    const label = document.createElement("label");
    label.className = "radio-option";
    label.innerHTML = `
      <input type="radio" name="payment-target" value="sidegoal:${g.id}" class="radio-input" />
      <span class="radio-box" aria-hidden="true"></span>
      ${escapeHtml(g.title)}
    `;
    group.appendChild(label);
  });

  if (!period) {
    duesOption.hidden = true;
    const firstSideGoalInput = group.querySelector('input[value^="sidegoal:"]');
    if (firstSideGoalInput) firstSideGoalInput.checked = true;
  }

  if (!period && sideGoals.length === 0) {
    document.getElementById("payment-submit-btn").disabled = true;
    document.getElementById("payment-error").textContent = "Nothing open to contribute to right now.";
  }
}

function renderShopOptions(settings) {
  shopPrices = {
    vip: Number(settings.vip_price) || 0,
    mvp: Number(settings.mvp_price) || 0,
    battlepass: Number(settings.battlepass_price) || 0,
  };

  document.getElementById("vip-option-label").textContent = `VIP — ${money(shopPrices.vip)}/month`;
  document.getElementById("mvp-option-label").textContent = `MVP — ${money(shopPrices.mvp)}/month`;
  document.getElementById("battlepass-option-label").textContent =
    `Legacy Pass — ${money(shopPrices.battlepass)} — 31 days of daily rewards`;
}

// Live, client-side estimate only — recomputed on every change to
// the target/rank/battlepass choices. Pre-fills "Amount sent" so
// most people never have to do the math, but never overwrites a
// value the member has actually typed themselves (see
// lastAutoFilledAmount).
function updateCheckoutSummary() {
  const summaryEl = document.getElementById("checkout-summary");
  const amountInput = document.getElementById("payment-amount");

  const checkedTarget = document.querySelector('input[name="payment-target"]:checked');
  const checkedRank = document.querySelector('input[name="payment-rank"]:checked');
  const battlepassChecked = document.getElementById("payment-battlepass").checked;

  const rows = [];
  let subtotal = 0;

  if (checkedTarget && checkedTarget.value === "period" && currentPeriod) {
    rows.push({ label: "This month's dues (live estimate)", amount: currentPeriod.duePerMember });
    subtotal += currentPeriod.duePerMember;
  } else if (checkedTarget && checkedTarget.value.startsWith("sidegoal:")) {
    rows.push({ label: "Side goal (enter your own amount below)", amount: null });
  }

  if (checkedRank && checkedRank.value) {
    const price = shopPrices[checkedRank.value] || 0;
    rows.push({ label: checkedRank.value.toUpperCase() + " rank", amount: price });
    subtotal += price;
  }

  if (battlepassChecked) {
    rows.push({ label: "Legacy Pass", amount: shopPrices.battlepass });
    subtotal += shopPrices.battlepass;
  }

  const discountApplied = Math.min(discountBalance, subtotal);
  const total = subtotal - discountApplied;

  summaryEl.hidden = rows.length === 0;

  if (rows.length === 0) {
    summaryEl.innerHTML = "";
  } else {
    summaryEl.innerHTML = rows.map(r => `
      <div class="checkout-summary-row">
        <span>${escapeHtml(r.label)}</span>
        <span>${r.amount === null ? "—" : money(r.amount)}</span>
      </div>
    `).join("") + (discountApplied > 0 ? `
      <div class="checkout-summary-row">
        <span class="discount">Discount credit applied</span>
        <span class="discount">−${money(discountApplied)}</span>
      </div>
    ` : "") + `
      <div class="checkout-summary-row total">
        <span>Suggested total</span>
        <span>${money(total)}</span>
      </div>
    `;
  }

  // Only overwrite the field if it's empty or still matches our own
  // last suggestion — a member's own typed number is never clobbered.
  if (amountInput.value === "" || amountInput.value === lastAutoFilledAmount) {
    amountInput.value = total > 0 ? total.toFixed(2) : "";
    lastAutoFilledAmount = amountInput.value;
  }

  return discountApplied;
}

async function loadRemainingBalance() {
  if (!currentPeriod) {
    renderSummaryTiles(null, 0);
    return;
  }

  const { data } = await supabaseClient
    .from("payment_submissions")
    .select("amount_claimed")
    .eq("user_id", currentUser.id)
    .eq("period_id", currentPeriod.id)
    .eq("status", "approved");

  const approvedForPeriod = (data || []).reduce((sum, r) => sum + Number(r.amount_claimed), 0);
  const remaining = Math.max(0, currentPeriod.duePerMember - approvedForPeriod);

  renderSummaryTiles(currentPeriod, remaining);
}

function wireForm() {
  // Any change to what's being bought re-estimates the total and
  // (usually) re-fills "Amount sent" — see updateCheckoutSummary().
  document.querySelectorAll('input[name="payment-target"]').forEach(input => {
    input.addEventListener("change", updateCheckoutSummary);
  });
  document.querySelectorAll('input[name="payment-rank"]').forEach(input => {
    input.addEventListener("change", updateCheckoutSummary);
  });
  document.getElementById("payment-battlepass").addEventListener("change", updateCheckoutSummary);

  document.getElementById("payment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("payment-error");
    const successEl = document.getElementById("payment-success");
    errorEl.textContent = "";
    successEl.textContent = "";

    const checkedTarget = document.querySelector('input[name="payment-target"]:checked');
    const checkedRank = document.querySelector('input[name="payment-rank"]:checked');
    const battlepassChecked = document.getElementById("payment-battlepass").checked;
    const amount = parseFloat(document.getElementById("payment-amount").value);
    const ref = document.getElementById("payment-ref").value.trim();
    const file = document.getElementById("payment-screenshot").files[0];

    if (!checkedTarget) {
      errorEl.textContent = "Choose what this payment is for.";
      return;
    }
    if (!amount || amount <= 0) {
      errorEl.textContent = "Enter an amount greater than 0.";
      return;
    }
    if (!ref) {
      errorEl.textContent = "Enter the GCash reference number.";
      return;
    }
    if (!file) {
      errorEl.textContent = "Attach a screenshot of the confirmation.";
      return;
    }

    // Recompute right now, not from a possibly-stale render — this
    // is also what actually gets reserved against the balance.
    const discountApplied = updateCheckoutSummary();

    const submitBtn = document.getElementById("payment-submit-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Uploading…";

    const path = `${currentUser.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabaseClient.storage
      .from("payment-screenshots")
      .upload(path, file);

    if (uploadError) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit for review";
      errorEl.textContent = "Couldn't upload screenshot: " + uploadError.message;
      return;
    }

    submitBtn.textContent = "Submitting…";

    const params = {
      p_amount: amount,
      p_gcash_ref: ref,
      p_screenshot_path: path,
      p_period_id: null,
      p_side_goal_id: null,
      p_rank_purchased: checkedRank && checkedRank.value ? checkedRank.value : null,
      p_battlepass_purchased: battlepassChecked,
      p_discount_applied: discountApplied,
    };
    if (checkedTarget.value === "period") {
      params.p_period_id = currentPeriod.id;
    } else {
      params.p_side_goal_id = checkedTarget.value.split(":")[1];
    }

    const { error: submitError } = await supabaseClient.rpc("submit_payment", params);

    submitBtn.disabled = false;
    submitBtn.textContent = "Submit for review";

    if (submitError) {
      errorEl.textContent = submitError.message;
      return;
    }

    document.getElementById("payment-form").reset();
    lastAutoFilledAmount = null;
    successEl.textContent = "Submitted! An admin will review it soon.";
    discountBalance -= discountApplied;
    updateCheckoutSummary();
    loadRemainingBalance();
  });
}

async function loadPaymentPage(user) {
  currentUser = user;

  const [period, sideGoals, settings, balance] = await Promise.all([
    loadCurrentPeriod(),
    loadActiveSideGoals(),
    loadGcashSettings(),
    loadMyDiscountBalance(),
  ]);

  currentPeriod = period;
  discountBalance = balance;

  renderPeriodCard(period);
  renderGcashDetails(settings);
  renderShopOptions(settings);
  renderSideGoalOptions(sideGoals, period);
  wireForm();
  updateCheckoutSummary();

  await loadRemainingBalance();
}
