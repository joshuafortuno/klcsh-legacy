/*
  NAV-TRANSITIONS.JS
  --------------------------------------------------------
  Wires the sliding underline + directional page-slide between the
  four primary nav links, in this fixed order:
    Home -> Contributions -> Contributors -> About

  This is a real multi-page site (no client-side router), so
  "sliding to a new page" is faked in two halves across two
  separate page loads:

    1. On click (this page, about to leave): slide the underline
       to the clicked link, slide THIS page's <main> out in the
       direction OPPOSITE the underline's travel, stash the
       intended entry direction in sessionStorage, then actually
       navigate once that finishes.
    2. On load (the page just arrived at): a tiny inline script at
       the top of <body> (see this page's HTML) already read that
       stashed direction and gave <main> its offscreen starting
       transform before <main> was even parsed — so this file just
       has to release it back to center and clear the flag, so a
       plain refresh doesn't replay the animation.

  Only included on the four pages this order applies to. Other
  pages that also show this nav bar (Contribute, Settings, etc.)
  aren't part of the ordered set and keep plain instant navigation.
  --------------------------------------------------------
*/

const NAV_ORDER = ["/", "/contributions", "/contributors", "/about"];
const NAV_TRANSITION_MS = 320; // must match style.css's `main` transition duration

function currentNavIndex() {
  const active = document.querySelector(".main-nav a.active");
  if (!active) return -1;
  return NAV_ORDER.indexOf(new URL(active.href).pathname);
}

function placeNavIndicator(indicator, link) {
  indicator.style.left = link.offsetLeft + "px";
  indicator.style.width = link.offsetWidth + "px";
}

function setupNavIndicator() {
  const nav = document.querySelector(".main-nav");
  const active = nav ? nav.querySelector("a.active") : null;
  if (!nav || !active) return null;

  const indicator = document.createElement("span");
  indicator.className = "nav-indicator";
  indicator.style.transition = "none"; // first placement shouldn't animate in from nowhere
  nav.appendChild(indicator);
  placeNavIndicator(indicator, active);

  // Two rAFs: the first lets the browser paint the untransitioned
  // starting position, the second hands control back to the CSS
  // class's transition for every move after this one.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      indicator.style.transition = "";
    });
  });

  return { nav, indicator };
}

(function releaseEntryTransition() {
  const pending = sessionStorage.getItem("navEnterFrom");
  if (!pending) return;
  sessionStorage.removeItem("navEnterFrom");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("nav-enter-left", "nav-enter-right");
    });
  });
})();

(function initNavIndicatorAndClicks() {
  const setup = setupNavIndicator();
  if (!setup) return;

  const { nav, indicator } = setup;
  const currentIndex = currentNavIndex();

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", (e) => {
      const targetIndex = NAV_ORDER.indexOf(new URL(link.href).pathname);
      if (targetIndex === -1 || currentIndex === -1 || targetIndex === currentIndex) return;

      e.preventDefault();

      const movingRight = targetIndex > currentIndex;
      const main = document.querySelector("main");

      placeNavIndicator(indicator, link);
      if (main) main.classList.add(movingRight ? "nav-exit-left" : "nav-exit-right");

      sessionStorage.setItem("navEnterFrom", movingRight ? "right" : "left");

      window.setTimeout(() => {
        window.location.href = link.href;
      }, NAV_TRANSITION_MS);
    });
  });
})();
