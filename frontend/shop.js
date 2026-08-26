/*
  SHOP.JS
  --------------------------------------------------------
  Purely informational — prices come from site_settings (admin-
  editable on the Manage Contributions page), the rank perks table
  is static markup in shop.html (a fixed comparison, not something
  that needs a database round-trip), and the Legacy Pass blurb is
  computed here from battlepass_reward_schedule — the total
  claimblocks/discount a player gets if they claim every one of the
  31 days, rather than a hand-written description someone has to
  keep in sync with the actual schedule by hand. Plus a quick "what
  you currently have" summary via get_my_profile() (rank/expiry) and
  a self-view battlepass_cycles check. Buying itself happens on
  /pay; this page just explains what's on offer and links there.
  money()/formatDate()/escapeHtml() come from /utils.js, loaded
  before this file.
  --------------------------------------------------------
*/

async function loadShop() {
  const [{ data: settings, error: settingsError }, { data: profile }, { data: cycles }, { data: schedule }] = await Promise.all([
    supabaseClient
      .from("site_settings")
      .select("vip_price, mvp_price, battlepass_price")
      .eq("id", 1)
      .single(),
    supabaseClient.rpc("get_my_profile"),
    supabaseClient.from("battlepass_cycles").select("expires_at").order("expires_at", { ascending: false }).limit(1),
    supabaseClient.from("battlepass_reward_schedule").select("reward_type, reward_amount"),
  ]);

  if (settingsError) {
    document.getElementById("shop-error").textContent = "Couldn't load shop info: " + escapeHtml(settingsError.message);
    return;
  }

  document.getElementById("vip-price").textContent = money(settings.vip_price) + "/month";
  document.getElementById("mvp-price").textContent = money(settings.mvp_price) + "/month";
  document.getElementById("battlepass-price").textContent = money(settings.battlepass_price);

  document.getElementById("battlepass-description").textContent = battlepassTotalLabel(schedule || []);

  const me = profile && profile[0] ? profile[0] : null;
  const latestCycle = cycles && cycles[0] ? cycles[0] : null;
  const activeCycle = latestCycle && new Date(latestCycle.expires_at) > new Date() ? latestCycle : null;

  renderMyStatus(me, activeCycle);
}

// Sums the 31-day reward schedule into one "here's the total if you
// claim every day" line, instead of a hand-written blurb that can
// silently drift out of sync with whatever the schedule actually is.
function battlepassTotalLabel(schedule) {
  const totalClaimblocks = schedule
    .filter(r => r.reward_type === "claimblocks")
    .reduce((sum, r) => sum + Number(r.reward_amount), 0);
  const totalDiscount = schedule
    .filter(r => r.reward_type === "discount")
    .reduce((sum, r) => sum + Number(r.reward_amount), 0);

  const parts = [];
  if (totalClaimblocks > 0) parts.push(`${totalClaimblocks.toLocaleString()} claimblocks`);
  if (totalDiscount > 0) parts.push(`${money(totalDiscount)} in discount credit`);

  return parts.length > 0
    ? `31 days of daily rewards — claim every single day and it adds up to ${parts.join(" + ")}.`
    : "31 days of daily rewards.";
}

// Renders each active perk as its own colored badge (reusing the
// same rank/Legacy Pass colors used everywhere else on the site)
// plus its expiry as separate supporting text, rather than one
// plain sentence that made rank/pass/dates hard to pick out at a
// glance.
function renderMyStatus(me, activeCycle) {
  const el = document.getElementById("my-shop-status");

  const hasRank = me && me.rank && me.rank !== "none";
  const hasPass = !!activeCycle;

  if (!hasRank && !hasPass) {
    el.innerHTML = `<span class="my-shop-empty">You don't have an active rank or Legacy Pass right now.</span>`;
    return;
  }

  const chips = [];
  if (hasRank) {
    chips.push(`
      <span class="my-shop-chip">
        <span class="status-badge status-badge--${me.rank}">${me.rank.toUpperCase()}</span>
        until ${formatDate(me.rank_expires_at)}
      </span>
    `);
  }
  if (hasPass) {
    chips.push(`
      <span class="my-shop-chip">
        <span class="status-badge status-badge--battlepass">Legacy Pass</span>
        until ${formatDate(activeCycle.expires_at)}
      </span>
    `);
  }

  el.innerHTML = `<span class="my-shop-label">You currently have</span>${chips.join("")}`;
}
