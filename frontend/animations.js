/*
  ANIMATIONS.JS
  --------------------------------------------------------
  Two small, self-contained pieces of polish shared across every
  public/member page (not the admin dashboard — that's a work tool,
  not a showcase):

  1. Scroll reveal — anything marked [data-reveal] fades/slides in
     the first time it enters the viewport, then stops being
     watched (one-shot, not a replay-on-every-scroll effect).
     [data-reveal-group] does the same to the ELEMENT ITSELF, and
     its direct children stagger in via plain CSS nth-child delays
     (see style.css) — which means a page-specific script
     (script.js, ledger.js, contributors.js, etc.) that fills a
     [data-reveal-group] container with rows/cards *after* this
     file has already run doesn't need to know animations.js
     exists at all. The container was already being watched; its
     newly-added children just inherit whatever reveal state the
     container is already in via a plain CSS descendant selector.

  2. animateCount() — counts a number up from 0 to its real value
     with an ease-out curve, used for the homepage stats row.
     Exposed on window so page-specific render code can call it
     once real data comes back from Supabase.

  These deliberately ignore prefers-reduced-motion — they're short,
  triggered by a clear action (a click, a scroll), not large ambient
  motion, and in practice that media flag mostly reflects a plain OS
  "animation effects" toggle (off by default in some Windows setups)
  rather than a real vestibular-motion preference.
  --------------------------------------------------------
*/

function initScrollReveal(root = document) {
  const targets = root.querySelectorAll("[data-reveal], [data-reveal-group]");
  if (targets.length === 0) return;

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        obs.unobserve(entry.target);
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );

  targets.forEach((el) => observer.observe(el));
}

function animateCount(el, target, { duration = 900, prefix = "", suffix = "", format } = {}) {
  const renderValue = format || ((n) => Math.round(n).toLocaleString());
  const start = performance.now();

  function tick(now) {
    const elapsed = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - elapsed, 3); // ease-out cubic
    el.textContent = prefix + renderValue(target * eased) + suffix;
    if (elapsed < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

window.initScrollReveal = initScrollReveal;
window.animateCount = animateCount;

document.addEventListener("DOMContentLoaded", () => initScrollReveal(document));
