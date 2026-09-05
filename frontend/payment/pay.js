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

// Current rank/Legacy Pass state — used by applyShopLocks() to lock
// out an invalid selection (MVP holder can't pick VIP; can't buy a
// second Legacy Pass while one's active) and by updateCheckoutSummary()
// to preview the VIP->MVP upgrade bonus. null/false means "nothing
// active right now."
let currentRank = null;
let currentRankExpiresAt = null;
let activeBattlepassExpiry = null;

// Set by loadRemainingBalance() — true once the member has a pending
// or approved dues payment for the current period. No installments:
// submit_payment() now requires a single dues submission to cover
// the full due amount, so there's never a reason to let someone
// select "Dues" a second time — see applyShopLocks().
let hasDuesPaymentForPeriod = false;

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

// Also reads rank/rank_expires_at now — get_my_profile() already
// returned these, they just weren't read before applyShopLocks()
// needed them.
async function loadMyProfile() {
  const { data } = await supabaseClient.rpc("get_my_profile");
  const me = data && data[0] ? data[0] : null;
  return {
    discountBalance: me ? Number(me.discount_credits) || 0 : 0,
    rank: me ? me.rank : null,
    rankExpiresAt: me ? me.rank_expires_at : null,
  };
}

async function loadMyActiveBattlepass() {
  const { data } = await supabaseClient
    .from("battlepass_cycles")
    .select("expires_at")
    .order("expires_at", { ascending: false })
    .limit(1);

  const latest = data && data[0] ? data[0] : null;
  return latest && new Date(latest.expires_at) > new Date() ? latest.expires_at : null;
}

function rankIsActive(rank, expiresAt) {
  return rank && rank !== "none" && expiresAt && new Date(expiresAt) > new Date();
}

// 50% of the remaining VIP time carries over as bonus days on an
// upgrade to MVP — same formula as apply_shop_purchase() in
// database/24_rank_upgrade_logic.sql, kept in sync by hand since one
// lives in JS (for the live preview) and one in SQL (what actually
// gets granted). Rounding matches that spec exactly: over .5 rounds
// up, .5 or under rounds down.
function computeUpgradeBonusDays() {
  if (!rankIsActive(currentRank, currentRankExpiresAt) || currentRank !== "vip") return 0;

  const remainingDays = Math.max(0, (new Date(currentRankExpiresAt).getTime() - Date.now()) / 86400000);
  const bonusRaw = remainingDays * 0.5;
  const fraction = bonusRaw - Math.floor(bonusRaw);
  return fraction > 0.5 ? Math.ceil(bonusRaw) : Math.floor(bonusRaw);
}

// Disables whichever rank/Legacy Pass option the member currently
// can't select, with a short explanation — rather than letting them
// pick it and only finding out it's rejected after they've already
// filled out and submitted the whole form. Mirrors the rules
// apply_shop_purchase() enforces server-side.
function applyShopLocks() {
  const vipInput = document.querySelector('input[name="payment-rank"][value="vip"]');
  const rankLockHint = document.getElementById("rank-lock-hint");

  if (currentRank === "mvp" && rankIsActive(currentRank, currentRankExpiresAt)) {
    vipInput.disabled = true;
    rankLockHint.textContent =
      `You already have MVP until ${formatDate(currentRankExpiresAt)} — it needs to expire before you can select VIP.`;
    rankLockHint.hidden = false;
  } else {
    vipInput.disabled = false;
    rankLockHint.hidden = true;
  }

  const battlepassInput = document.getElementById("payment-battlepass");
  const battlepassLockHint = document.getElementById("battlepass-lock-hint");

  if (BATTLEPASS_DISABLED) {
    battlepassInput.checked = false;
    battlepassInput.disabled = true;
    battlepassLockHint.textContent = "Legacy Pass purchases are temporarily unavailable.";
    battlepassLockHint.hidden = false;
  } else if (activeBattlepassExpiry) {
    battlepassInput.disabled = true;
    battlepassLockHint.textContent =
      `You already have an active Legacy Pass until ${formatDate(activeBattlepassExpiry)} — you can buy another once it expires.`;
    battlepassLockHint.hidden = false;
  } else {
    battlepassInput.disabled = false;
    battlepassLockHint.hidden = true;
  }

  const duesInput = document.querySelector('input[name="payment-target"][value="period"]');
  const duesLockHint = document.getElementById("dues-lock-hint");

  if (hasDuesPaymentForPeriod) {
    duesInput.checked = false;
    duesInput.disabled = true;
    duesLockHint.textContent = "You already have a dues payment for this period — no need for another one.";
    duesLockHint.hidden = false;
  } else {
    duesInput.disabled = false;
    duesLockHint.hidden = true;
  }
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

// Adds one option per active side goal. These render as checkboxes,
// not radios — see wireForm()'s payment-target listener, which
// enforces "at most one checked" by hand. That's what lets clicking
// the currently-selected option unselect it again, landing back on
// "nothing selected" — a native radio group can never reach that
// state once one option's been picked, and that "nothing" state is
// exactly a shop-only purchase (rank and/or Legacy Pass, no dues/
// side-goal component — see submit_payment() in
// database/16_shop_only_payments.sql, which is what actually allows
// this rather than rejecting it). Hides "Dues" when there's no
// open period, leaving nothing checked in that case
// rather than forcing a side-goal pick the member may not want.
function renderSideGoalOptions(sideGoals, period) {
  const group = document.getElementById("payment-target-group");
  const duesOption = group.querySelector('input[value="period"]').closest(".radio-option");

  sideGoals.forEach(g => {
    const label = document.createElement("label");
    label.className = "radio-option";
    label.innerHTML = `
      <input type="checkbox" name="payment-target" value="sidegoal:${g.id}" class="radio-input" />
      <span class="radio-box" aria-hidden="true"></span>
      ${escapeHtml(g.title)}
    `;
    group.appendChild(label);
  });

  if (!period) {
    duesOption.hidden = true;
    duesOption.querySelector("input").checked = false;
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

  const bonusHintEl = document.getElementById("upgrade-bonus-hint");
  if (checkedRank && checkedRank.value === "mvp" && currentRank === "vip" && rankIsActive(currentRank, currentRankExpiresAt)) {
    const bonusDays = computeUpgradeBonusDays();
    bonusHintEl.textContent = bonusDays > 0
      ? `Upgrading now carries over ${bonusDays} bonus day${bonusDays === 1 ? "" : "s"} from your remaining VIP time, on top of the usual 30 days of MVP.`
      : "Upgrading now — your remaining VIP time is under a day, so no bonus days carry over, but you'll still get the usual 30 days of MVP.";
    bonusHintEl.hidden = false;
  } else {
    bonusHintEl.hidden = true;
  }

  const rows = [];
  let subtotal = 0;

  if (checkedTarget && checkedTarget.value === "period" && currentPeriod) {
    rows.push({ label: "Dues (live estimate)", amount: currentPeriod.duePerMember });
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
    .select("amount_claimed, status")
    .eq("user_id", currentUser.id)
    .eq("period_id", currentPeriod.id);

  const rows = data || [];
  const approvedForPeriod = rows
    .filter(r => r.status === "approved")
    .reduce((sum, r) => sum + Number(r.amount_claimed), 0);
  const remaining = Math.max(0, currentPeriod.duePerMember - approvedForPeriod);

  // A rejected payment doesn't count — that's not "already paid",
  // it's cleared to try again.
  hasDuesPaymentForPeriod = rows.some(r => r.status === "pending" || r.status === "approved");

  renderSummaryTiles(currentPeriod, remaining);
}

// Enforces "at most one checked" by hand for a same-name group of
// checkboxes used as a single-choice-or-none picker (payment-target,
// payment-rank) — unlike a radio group, a checkbox can be clicked
// again to return to "nothing checked", which is what lets both of
// these pickers default to "none of these" without a dedicated
// option for it.
function wireExclusiveCheckboxGroup(name, onChange) {
  const inputs = document.querySelectorAll(`input[name="${name}"]`);
  inputs.forEach(input => {
    input.addEventListener("change", () => {
      if (input.checked) {
        inputs.forEach(other => {
          if (other !== input) other.checked = false;
        });
      }
      onChange();
    });
  });
}

function wireForm() {
  // Any change to what's being bought re-estimates the total and
  // (usually) re-fills "Amount sent" — see updateCheckoutSummary().
  wireExclusiveCheckboxGroup("payment-target", updateCheckoutSummary);
  wireExclusiveCheckboxGroup("payment-rank", updateCheckoutSummary);
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

    // checkedTarget being null is a valid state now (nothing
    // selected — a shop-only purchase), not an error on its own —
    // it's only a problem if there's also no rank and no battlepass,
    // i.e. this payment isn't for anything at all.
    if (!checkedTarget && !(checkedRank && checkedRank.value) && !battlepassChecked) {
      errorEl.textContent = "Choose what this payment is for — dues, a side goal, or a shop purchase.";
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
    if (checkedTarget && checkedTarget.value === "period") {
      params.p_period_id = currentPeriod.id;
    } else if (checkedTarget && checkedTarget.value.startsWith("sidegoal:")) {
      params.p_side_goal_id = checkedTarget.value.split(":")[1];
    }
    // else: nothing selected — p_period_id/p_side_goal_id both stay
    // null, a pure shop purchase.

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

  const [period, sideGoals, settings, profile, battlepassExpiry] = await Promise.all([
    loadCurrentPeriod(),
    loadActiveSideGoals(),
    loadGcashSettings(),
    loadMyProfile(),
    loadMyActiveBattlepass(),
  ]);

  currentPeriod = period;
  discountBalance = profile.discountBalance;
  currentRank = profile.rank;
  currentRankExpiresAt = profile.rankExpiresAt;
  activeBattlepassExpiry = battlepassExpiry;

  renderPeriodCard(period);
  renderGcashDetails(settings);
  renderShopOptions(settings);
  renderSideGoalOptions(sideGoals, period);
  wireForm();
  updateCheckoutSummary();

  await loadRemainingBalance(); // sets hasDuesPaymentForPeriod — must resolve before applyShopLocks()
  applyShopLocks();
}
