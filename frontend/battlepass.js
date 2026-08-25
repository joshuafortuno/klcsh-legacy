/*
  BATTLEPASS.JS
  --------------------------------------------------------
  battlepass_reward_schedule is publicly readable (any logged-in
  member can see the full 31-day track, including days they haven't
  reached yet — no surprise there, it's a fixed schedule, not a
  mystery box). battlepass_cycles/battlepass_claims are self-view
  only, which is exactly what this page needs: whether *I* have an
  active pass, and which days *I've* already claimed.

  "Day N" is computed the same way the database does it in
  claim_battlepass_day() — day 1 immediately on purchase, a new day
  unlocks every 24h after that, capped at 31 — so what this page
  shows as claimable always matches what the backend will actually
  accept.

  money()/formatDate()/escapeHtml() come from /utils.js, loaded
  before this file.
  --------------------------------------------------------
*/

async function loadBattlepass() {
  const statusEl = document.getElementById("battlepass-status");
  const noPassEl = document.getElementById("battlepass-no-pass");

  const [{ data: schedule, error: scheduleError }, { data: cycles }] = await Promise.all([
    supabaseClient
      .from("battlepass_reward_schedule")
      .select("day_number, reward_type, reward_amount")
      .order("day_number", { ascending: true }),
    supabaseClient
      .from("battlepass_cycles")
      .select("id, started_at, expires_at")
      .order("expires_at", { ascending: false })
      .limit(1),
  ]);

  if (scheduleError) {
    statusEl.textContent = "Couldn't load the reward schedule: " + scheduleError.message;
    return;
  }

  const latestCycle = cycles && cycles[0] ? cycles[0] : null;
  const activeCycle = latestCycle && new Date(latestCycle.expires_at) > new Date() ? latestCycle : null;

  // The reward track is always visible, active pass or not — it's
  // the best pitch for buying one. Without a pass, elapsedDay stays
  // 0, so every day in renderGrid() falls through to "locked" (day
  // numbers start at 1, so nothing is ever <= 0) with no claim
  // button, rather than hiding the grid entirely.
  if (!activeCycle) {
    statusEl.textContent = "You don't have an active Legacy Pass right now — here's what's on offer.";
    noPassEl.hidden = false;
    renderGrid(schedule, new Set(), 0);
    return;
  }

  noPassEl.hidden = true;

  const { data: claims } = await supabaseClient
    .from("battlepass_claims")
    .select("day_number")
    .eq("cycle_id", activeCycle.id);

  const claimedDays = new Set((claims || []).map(c => c.day_number));
  const elapsedDay = Math.min(31, Math.floor((Date.now() - new Date(activeCycle.started_at).getTime()) / 86400000) + 1);

  statusEl.textContent = `Day ${elapsedDay} of 31 — active until ${formatDate(activeCycle.expires_at)}.`;

  renderGrid(schedule, claimedDays, elapsedDay);
}

// Day 31 always gets the trophy treatment regardless of its reward
// type (it's the jackpot day) — everything else is icon-by-type.
const REWARD_ICONS = { claimblocks: "🧱", discount: "🏷️" };

function rewardIcon(day) {
  if (day.day_number === 31) return "🏆";
  return REWARD_ICONS[day.reward_type] || "🎁";
}

function renderGrid(schedule, claimedDays, elapsedDay) {
  const gridEl = document.getElementById("battlepass-grid");

  gridEl.innerHTML = schedule.map(day => {
    const claimed = claimedDays.has(day.day_number);
    const unlocked = day.day_number <= elapsedDay;
    const rewardLabel = day.reward_type === "discount"
      ? `${money(day.reward_amount)} discount`
      : `${Number(day.reward_amount)} claimblocks`;

    let stateClass = "battlepass-day--locked";
    let actionHtml = `<span class="battlepass-day-state">Locked</span>`;
    if (claimed) {
      stateClass = "battlepass-day--claimed";
      actionHtml = `<span class="battlepass-day-state">✓ Claimed</span>`;
    } else if (unlocked) {
      stateClass = "battlepass-day--claimable";
      actionHtml = `<button type="button" class="btn-small btn-approve" data-claim-day="${day.day_number}">Claim</button>`;
    }

    return `
      <div class="battlepass-day ${stateClass}">
        <div class="battlepass-day-icon">${rewardIcon(day)}</div>
        <div class="battlepass-day-number">Day ${day.day_number}</div>
        <div class="battlepass-day-reward">${escapeHtml(rewardLabel)}</div>
        ${actionHtml}
      </div>
    `;
  }).join("");

  gridEl.querySelectorAll("[data-claim-day]").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Claiming…";
      const { error } = await supabaseClient.rpc("claim_battlepass_day", {
        p_day_number: parseInt(btn.dataset.claimDay, 10),
      });
      if (error) {
        document.getElementById("battlepass-status").textContent = error.message;
        btn.disabled = false;
        btn.textContent = "Claim";
        return;
      }

      // A quick celebratory pulse on the card that was just claimed,
      // held just long enough to register, before the full refresh
      // settles it into its normal "claimed" state — otherwise the
      // reward just silently changes with no sense anything happened.
      const card = btn.closest(".battlepass-day");
      card.classList.add("battlepass-day--just-claimed");
      await new Promise(resolve => setTimeout(resolve, 450));

      loadBattlepass();
    });
  });
}
