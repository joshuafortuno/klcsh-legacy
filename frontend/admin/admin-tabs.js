/*
  ADMIN-TABS.JS
  --------------------------------------------------------
  Turns a run of [data-tab] buttons inside a .admin-tabs container
  into a single-panel-at-a-time view over the .admin-card elements
  sharing their data-panel value — used on the admin pages that used
  to stack several .admin-cards in a row (Notifications, Manage
  Contributions, Contributions). Auto-wires every .admin-tabs found
  on the page and defers to whichever panel the HTML already marks
  active, so a page just needs the markup — no per-page JS call
  needed, same pattern as animations.js's scroll reveal.

  activateAdminTab() is exposed on window for the one case a page
  needs to override which tab starts active — manage-contributions.js
  calls it so the "Edit" link from Past periods (?period=<id> in the
  URL) lands straight on the "This month's goal" tab instead of the
  default first one. That kind of switch is instant (it's the page's
  *starting* state, not something the user clicked toward) — animate
  defaults to false and only a real tab click passes true.

  Only the swap is handled here — each page's own script (loaded
  after this one) still owns fetching/rendering the data inside
  every panel exactly as before; this never touches that.
  --------------------------------------------------------
*/

function activateAdminTab(tabKey, { animate = false } = {}) {
  const nextBtn = document.querySelector(`.admin-tabs [data-tab="${tabKey}"]`);
  const tabsEl = nextBtn && nextBtn.closest(".admin-tabs");
  if (!tabsEl) return;

  const tabs = Array.from(tabsEl.querySelectorAll("[data-tab]"));
  const currentBtn = tabs.find((t) => t.classList.contains("active"));
  if (nextBtn === currentBtn) return;

  const nextPanel = document.querySelector(`[data-panel="${tabKey}"]`);
  const currentPanel = currentBtn ? document.querySelector(`[data-panel="${currentBtn.dataset.tab}"]`) : null;
  if (!nextPanel) return;

  tabs.forEach((t) => {
    t.classList.toggle("active", t === nextBtn);
    t.setAttribute("aria-selected", t === nextBtn ? "true" : "false");
  });

  if (!animate) {
    if (currentPanel) currentPanel.hidden = true;
    nextPanel.hidden = false;
    return;
  }

  // Both panels move in the same "toward/away from the tab bar"
  // direction — the outgoing one lifts up and fades as if retracting
  // into the tabs above it, the incoming one drops down from that
  // same spot into place, rather than either just popping in/out.
  if (currentPanel) {
    currentPanel.classList.add("admin-panel-leave");
    currentPanel.addEventListener("animationend", function onLeave() {
      currentPanel.classList.remove("admin-panel-leave");
      currentPanel.hidden = true;
      currentPanel.removeEventListener("animationend", onLeave);
    }, { once: true });
  }

  nextPanel.hidden = false;
  nextPanel.classList.add("admin-panel-enter");
  nextPanel.addEventListener("animationend", function onEnter() {
    nextPanel.classList.remove("admin-panel-enter");
    nextPanel.removeEventListener("animationend", onEnter);
  }, { once: true });
}

function initAdminTabs(tabsEl) {
  tabsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tab]");
    if (!btn) return;
    activateAdminTab(btn.dataset.tab, { animate: true });
  });
}

window.activateAdminTab = activateAdminTab;

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".admin-tabs").forEach(initAdminTabs);
});
