/*
  SCRIPT.JS — homepage only
  --------------------------------------------------------
  This file's whole job: take the data from data.js and
  turn it into HTML elements on the page. Nothing here
  touches a server or a database yet — that's Step 3+.
  --------------------------------------------------------
*/

// Small helper: turns 340 into "₱340"
function money(n) {
  return `₱${n.toLocaleString()}`;
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
    blocksHtml += `<div class="voxel ${isFilled ? "filled" : ""}"></div>`;
  }
  return blocksHtml;
}

function renderSpotlightGoal() {
  const el = document.getElementById("spotlight-goal");
  const { title, target, current, deadline } = SPOTLIGHT_GOAL;
  const pct = Math.round((current / target) * 100);

  el.innerHTML = `
    <div class="goal-card-top">
      <h3>${title}</h3>
      <div class="goal-amounts"><strong>${money(current)}</strong> of ${money(target)}</div>
    </div>
    <div class="voxel-bar">${renderVoxelBar(current, target)}</div>
    <div class="goal-meta">
      <span>${pct}% funded</span>
      <span class="highlight">Needed by ${deadline}</span>
    </div>
  `;
}

function renderStats() {
  const el = document.getElementById("stats-row");

  const totalRaised = CONTRIBUTIONS.reduce((sum, c) => sum + c.amount, 0);
  const contributorCount = new Set(
    CONTRIBUTIONS.map(c => c.name).filter(n => n !== "Anonymous Miner")
  ).size;

  el.innerHTML = `
    <div class="stat">
      <div class="stat-value">${money(totalRaised)}</div>
      <div class="stat-label">Raised all time</div>
    </div>
    <div class="stat">
      <div class="stat-value">${contributorCount}</div>
      <div class="stat-label">Named contributors</div>
    </div>
    <div class="stat">
      <div class="stat-value">${SPOTLIGHT_GOAL.deadline}</div>
      <div class="stat-label">Next funding deadline</div>
    </div>
  `;
}

// Turns a handful of contributions that left a message into
// quote-style cards — reuses the same CONTRIBUTIONS data as the
// ledger, just displayed as shoutouts instead of a plain list.
function renderShoutoutCards() {
  const el = document.getElementById("shoutout-grid");
  const withMessages = CONTRIBUTIONS.filter(c => c.message).slice(0, 3);

  // No contributions have a message right now (real data doesn't
  // include any yet) — hide the whole section rather than show an
  // empty grid with a heading and nothing under it.
  if (withMessages.length === 0) {
    el.closest(".shoutouts").hidden = true;
    return;
  }

  el.innerHTML = withMessages.map(c => `
    <div class="shoutout-card">
      <p class="shoutout-quote">"${c.message}"</p>
      <div class="shoutout-meta">
        <span class="shoutout-name">${c.name}</span>
        <span class="shoutout-amount">+${money(c.amount)}</span>
      </div>
    </div>
  `).join("");
}

function renderGoalGrid() {
  const el = document.getElementById("goal-grid");

  el.innerHTML = OTHER_GOALS.map(g => {
    const pct = Math.round((g.current / g.target) * 100);
    return `
      <div class="goal-mini">
        <h4>${g.title}</h4>
        <div class="mini-bar">
          <div class="mini-bar-fill" style="width: ${pct}%"></div>
        </div>
        <div class="goal-meta">
          <span>${money(g.current)} / ${money(g.target)}</span>
          <span>${pct}%</span>
        </div>
      </div>
    `;
  }).join("");
}

// Placeholder for now — becomes a real Stripe Checkout call in Step 4
document.getElementById("contribute-btn").addEventListener("click", () => {
  alert("Payments aren't wired up yet — that's our next build step!");
});

// Run everything once the page loads
renderSpotlightGoal();
renderStats();
renderShoutoutCards();
renderGoalGrid();
