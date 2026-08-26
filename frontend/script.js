/*
  SCRIPT.JS — homepage only
  --------------------------------------------------------
  Everything here reads from real Supabase tables now — goals
  from periods/expenses/side_goals (edited in the admin's Manage
  Contributions page), and the stats row's totals from
  public_contribution_ledger() (database/09_public_ledger.sql),
  which unions the pre-launch legacy_contributions history with
  every approved live payment_submissions row — money(), escapeHtml()
  etc. come from /utils.js, loaded before this file. data.js is
  gone; there's no fake data left to stand in for.
  --------------------------------------------------------
*/

// "2026-09-01" -> "Sep 25, 2026". Periods don't store an explicit
// due date, so this derives one from the site's established
// monthly due date (the 25th — same day contribution records use).
// Built from year/month numbers rather than `new Date(monthStr)` +
// setDate() to avoid UTC-parse/local-timezone date-shifting bugs.
// Short month name on purpose — "Needed by September 25, 2026"
// next to "0% funded" doesn't fit in .goal-meta's row on a phone
// screen even with white-space:nowrap; the shorter form does.
function formatDeadline(monthDateStr) {
  const [year, month] = monthDateStr.split("-");
  const d = new Date(Number(year), Number(month) - 1, 25);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Fetches the currently open period plus its computed goal total
// (sum of its expenses) and how much has actually been collected
// (period_progress() — a public aggregate, never exposes
// individual payment rows). Returns null if there's no open
// period yet (e.g. the admin hasn't logged in and bootstrapped
// one via Manage Contributions).
async function loadCurrentPeriod() {
  const { data: period } = await supabaseClient
    .from("periods")
    .select("id, month, title")
    .eq("status", "open")
    .order("month", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!period) return null;

  const [{ data: expenses }, { data: raised }] = await Promise.all([
    supabaseClient.from("expenses").select("amount").eq("period_id", period.id),
    supabaseClient.rpc("period_progress", { p_period_id: period.id }),
  ]);

  return {
    title: period.title || "This month's goal",
    deadline: formatDeadline(period.month),
    target: (expenses || []).reduce((sum, e) => sum + Number(e.amount), 0),
    current: raised || 0,
  };
}

/*
  Builds the big voxel progress bar for one goal.
  We draw `totalBlocks` little squares, and color in
  however many represent the fraction that's funded.
*/
function renderVoxelBar(current, target, totalBlocks = 30) {
  const pct = Math.min(current / target, 1);
  const filledCount = Math.round(pct * totalBlocks);

  let blocksHtml = "";
  for (let i = 0; i < totalBlocks; i++) {
    const isFilled = i < filledCount;
    // Only filled blocks get the pop-in animation (they're the
    // meaningful part) — animation-delay staggers them left to
    // right, same idea as mini-bar-fill's dynamic width above.
    const delayAttr = isFilled ? ` style="animation-delay: ${i * 18}ms"` : "";
    blocksHtml += `<div class="voxel ${isFilled ? "filled voxel-pop" : ""}"${delayAttr}></div>`;
  }
  return blocksHtml;
}

function renderSpotlightGoal(period) {
  const el = document.getElementById("spotlight-goal");

  if (!period) {
    el.innerHTML = `<p class="hero-sub">No active goal right now — check back soon.</p>`;
    return;
  }

  const pct = period.target > 0 ? Math.round((period.current / period.target) * 100) : 0;

  el.innerHTML = `
    <div class="goal-card-top">
      <h3>${escapeHtml(period.title)}</h3>
      <div class="goal-amounts"><strong>${money(period.current)}</strong> of ${money(period.target)}</div>
    </div>
    <div class="voxel-bar">${renderVoxelBar(period.current, period.target)}</div>
    <div class="goal-meta">
      <span>${pct}% funded</span>
      <span class="highlight">Needed by ${period.deadline}</span>
    </div>
  `;
}

// Sums the full public ledger (pre-launch history + every approved
// live payment) for the stats row — plain client-side aggregation
// since this is public data anyway, and the row count here will
// never be large enough to need a database-side aggregate.
async function loadContributionStats() {
  const { data } = await supabaseClient.rpc("public_contribution_ledger");

  const rows = data || [];
  return {
    totalRaised: rows.reduce((sum, r) => sum + Number(r.amount), 0),
    contributorCount: new Set(rows.map(r => r.contributor_name)).size,
  };
}

function renderStats(period, stats) {
  const el = document.getElementById("stats-row");

  const totalRaised = stats ? stats.totalRaised : 0;
  const contributorCount = stats ? stats.contributorCount : 0;

  el.innerHTML = `
    <div class="stat">
      <div class="stat-value" id="stat-raised">₱0</div>
      <div class="stat-label">Raised all time</div>
    </div>
    <div class="stat">
      <div class="stat-value" id="stat-contributors">0</div>
      <div class="stat-label">Named contributors</div>
    </div>
    <div class="stat">
      <div class="stat-value">${period ? period.deadline : "—"}</div>
      <div class="stat-label">Next funding deadline</div>
    </div>
  `;

  // Counts up from 0 to the real value instead of just appearing —
  // animations.js is loaded before this file specifically so this
  // is always available (see index.html's script order).
  animateCount(document.getElementById("stat-raised"), totalRaised, {
    format: (n) => money(Math.round(n)),
  });
  animateCount(document.getElementById("stat-contributors"), contributorCount);
}

// Would turn contributions with a message into quote-style cards,
// but neither legacy_contributions nor payment_submissions has a
// message field in the current schema — there's nothing to show
// yet. Hides the section instead of an empty heading with nothing
// under it. Revisit if a "leave a note" field ever gets added to
// the payment submission flow.
function renderShoutoutCards() {
  document.querySelector(".shoutouts").hidden = true;
}

// Side goals (managed in the admin's Manage Contributions page,
// under "Side goals") — optional, voluntary goals outside the
// regular monthly split. Progress comes from side_goal_progress(),
// a public aggregate that sums approved contributions without
// exposing anyone's individual payment rows.
async function renderGoalGrid() {
  const el = document.getElementById("goal-grid");

  const { data: goals } = await supabaseClient
    .from("side_goals")
    .select("id, title, target")
    .eq("status", "active")
    .order("created_at", { ascending: false });

  const sideGoals = goals || [];

  // No active side goals right now — hide the section instead of
  // showing an empty heading with nothing under it.
  if (sideGoals.length === 0) {
    el.closest(".goals").hidden = true;
    return;
  }
  el.closest(".goals").hidden = false;

  const progressResults = await Promise.all(
    sideGoals.map(g => supabaseClient.rpc("side_goal_progress", { p_side_goal_id: g.id }))
  );

  el.innerHTML = sideGoals.map((g, i) => {
    const current = progressResults[i].data || 0;
    const pct = g.target > 0 ? Math.round((current / g.target) * 100) : 0;
    return `
      <div class="goal-mini">
        <h4>${escapeHtml(g.title)}</h4>
        <div class="mini-bar">
          <div class="mini-bar-fill" style="width: ${pct}%"></div>
        </div>
        <div class="goal-meta">
          <span>${money(current)} / ${money(g.target)}</span>
          <span>${pct}%</span>
        </div>
      </div>
    `;
  }).join("");
}

// Homepage teaser for the Shop — a second funding channel besides
// plain dues, so it gets its own pitch rather than being folded into
// .contribute-cta at the bottom (that one stays a plain donate ask).
// Prices come live from site_settings, the same source shop.js
// itself reads, so a price change in Manage Contributions shows up
// here too without a separate edit. This is a public pitch to
// everyone, not personalized — unlike shop.js it doesn't check
// what rank/pass the viewer currently has.
async function renderShopAd() {
  const { data: settings } = await supabaseClient
    .from("site_settings")
    .select("vip_price, mvp_price, battlepass_price")
    .eq("id", 1)
    .single();

  if (!settings) return;

  document.getElementById("shop-ad-grid").innerHTML = `
    <div class="shop-ad-card">
      <div class="shop-ad-icon">⭐</div>
      <h3>VIP</h3>
      <div class="shop-ad-price">${money(settings.vip_price)}<span>/month</span></div>
      <p>Extra claimblocks, more claim slots, and better crate loot.</p>
    </div>
    <div class="goal-card-glow">
      <div class="shop-ad-card shop-ad-card--featured">
        <div class="shop-ad-icon">👑</div>
        <h3>MVP</h3>
        <div class="shop-ad-price">${money(settings.mvp_price)}<span>/month</span></div>
        <p>Everything VIP gets, plus healing, feeding, and silk touch on certain blocks.</p>
      </div>
    </div>
    <div class="shop-ad-card">
      <div class="shop-ad-icon">🎟️</div>
      <h3>Legacy Pass</h3>
      <div class="shop-ad-price">${money(settings.battlepass_price)}</div>
      <p>31 days of daily login rewards — claimblocks and discounts, day after day.</p>
    </div>
  `;
}

// Run everything once the page loads
(async () => {
  const [period, stats] = await Promise.all([
    loadCurrentPeriod(),
    loadContributionStats(),
  ]);
  renderSpotlightGoal(period);
  renderStats(period, stats);
})();
renderShoutoutCards();
renderGoalGrid();
renderShopAd();
