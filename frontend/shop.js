/*
  SHOP.JS
  --------------------------------------------------------
  Purely informational — prices and descriptions come straight from
  site_settings (admin-editable on the Manage Contributions page),
  plus a quick "what you currently have" summary via get_my_profile()
  (rank/expiry) and a self-view battlepass_cycles check. Buying
  itself happens on /pay; this page just explains what's on offer
  and links there. money()/formatDate()/escapeHtml() come from
  /utils.js, loaded before this file.
  --------------------------------------------------------
*/

async function loadShop() {
  const [{ data: settings, error: settingsError }, { data: profile }, { data: cycles }] = await Promise.all([
    supabaseClient
      .from("site_settings")
      .select("vip_price, mvp_price, battlepass_price, vip_description, mvp_description, battlepass_description")
      .eq("id", 1)
      .single(),
    supabaseClient.rpc("get_my_profile"),
    supabaseClient.from("battlepass_cycles").select("expires_at").order("expires_at", { ascending: false }).limit(1),
  ]);

  if (settingsError) {
    document.getElementById("shop-error").textContent = "Couldn't load shop info: " + escapeHtml(settingsError.message);
    return;
  }

  document.getElementById("vip-price").textContent = money(settings.vip_price) + "/month";
  document.getElementById("mvp-price").textContent = money(settings.mvp_price) + "/month";
  document.getElementById("battlepass-price").textContent = money(settings.battlepass_price);

  document.getElementById("vip-description").textContent =
    settings.vip_description || "Ask an admin what this includes.";
  document.getElementById("mvp-description").textContent =
    settings.mvp_description || "Ask an admin what this includes.";
  document.getElementById("battlepass-description").textContent =
    settings.battlepass_description || "31 days of daily rewards.";

  const me = profile && profile[0] ? profile[0] : null;
  const latestCycle = cycles && cycles[0] ? cycles[0] : null;
  const activeCycle = latestCycle && new Date(latestCycle.expires_at) > new Date() ? latestCycle : null;

  renderMyStatus(me, activeCycle);
}

function renderMyStatus(me, activeCycle) {
  const el = document.getElementById("my-shop-status");
  const parts = [];

  if (me && me.rank && me.rank !== "none") {
    parts.push(`${me.rank.toUpperCase()} until ${formatDate(me.rank_expires_at)}`);
  }
  if (activeCycle) {
    parts.push(`Legacy Pass until ${formatDate(activeCycle.expires_at)}`);
  }

  el.textContent = parts.length > 0
    ? "You currently have: " + parts.join(" · ")
    : "You don't have an active rank or Legacy Pass right now.";
}
