/*
  UPDATES.JS
  --------------------------------------------------------
  Two independent things on this page:

  1. Install/update status — reads window.__deferredInstallPrompt
     and window.__swRegistration, both set by pwa-register.js.
     "Installed" is detected via display-mode: standalone (Chrome/
     Edge/Android) or navigator.standalone (iOS Safari has no
     beforeinstallprompt at all, so it always falls back to the
     manual "Add to Home Screen" instructions).

  2. CHANGELOG — a plain hardcoded array, not a database table.
     There's no admin UI for this; add a new entry at the top of
     the array by hand each time a real change ships. Paged the
     same 10-at-a-time way as every other list on the site, so it
     keeps working once this array gets long.
  --------------------------------------------------------
*/

const APP_VERSION = "1.1.0";

const CHANGELOG = [
  {
    version: "1.1.0",
    date: "2026-08-25",
    changes: [
      "KLCSH Legacy can now be installed as an app — add it to your home screen or desktop and open it in its own window.",
      "Installed pages keep working briefly if your connection drops.",
      "Added this Updates page.",
    ],
  },
];

const PAGE_SIZE = 10;
let changelogPage = 1;

function isStandaloneDisplay() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function renderInstallStatus() {
  const badge = document.getElementById("install-status-badge");
  const note = document.getElementById("install-note");
  const btn = document.getElementById("install-action-btn");

  if (isStandaloneDisplay()) {
    badge.textContent = "Installed";
    badge.className = "status-badge status-badge--approved";
    note.textContent = "You're running the installed app. It updates itself in the background — use this button to force a check right now.";
    btn.textContent = "Check for updates";
    btn.hidden = false;
    btn.disabled = false;
    btn.onclick = checkForUpdates;
    return;
  }

  badge.textContent = "Not installed";
  badge.className = "status-badge status-badge--pending";

  if (window.__deferredInstallPrompt) {
    note.textContent = "Installs KLCSH Legacy like an app — its own icon and window, and it keeps working if your connection drops.";
    btn.textContent = "Download app";
    btn.hidden = false;
    btn.disabled = false;
    btn.onclick = promptInstall;
  } else if (isIos()) {
    note.textContent = "On iPhone/iPad: tap the Share button in Safari, then \"Add to Home Screen.\"";
    btn.hidden = true;
  } else {
    note.textContent = "Your browser hasn't offered an install prompt yet. Look for an install icon in the address bar, or check your browser's menu for \"Install app\" / \"Add to Home screen.\"";
    btn.hidden = true;
  }
}

async function promptInstall() {
  const promptEvent = window.__deferredInstallPrompt;
  if (!promptEvent) return;

  promptEvent.prompt();
  const { outcome } = await promptEvent.userChoice;
  if (outcome === "accepted") {
    window.__deferredInstallPrompt = null;
  }
  renderInstallStatus();
}

async function checkForUpdates() {
  const btn = document.getElementById("install-action-btn");
  const note = document.getElementById("install-note");

  btn.disabled = true;
  note.textContent = "Checking…";

  try {
    const registration = window.__swRegistration || (await navigator.serviceWorker.getRegistration());
    if (registration) await registration.update();
    note.textContent = "You're up to date.";
  } catch (error) {
    note.textContent = "Couldn't check for updates right now.";
  }

  btn.disabled = false;
}

function renderChangelog() {
  const listEl = document.getElementById("changelog-list");
  const emptyEl = document.getElementById("changelog-empty");
  const prevBtn = document.getElementById("changelog-prev-page");
  const nextBtn = document.getElementById("changelog-next-page");

  if (CHANGELOG.length === 0) {
    listEl.innerHTML = "";
    emptyEl.innerHTML = `<div class="ledger-empty">No updates logged yet.</div>`;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(CHANGELOG.length / PAGE_SIZE));
  changelogPage = Math.min(changelogPage, totalPages);
  const start = (changelogPage - 1) * PAGE_SIZE;
  const pageItems = CHANGELOG.slice(start, start + PAGE_SIZE);

  emptyEl.innerHTML = "";
  listEl.innerHTML = pageItems
    .map(
      (entry) => `
    <div class="changelog-entry">
      <div class="changelog-entry-head">
        <span class="changelog-version">v${entry.version}</span>
        <span class="changelog-date">${entry.date}</span>
      </div>
      <ul>
        ${entry.changes.map((c) => `<li>${c}</li>`).join("")}
      </ul>
    </div>
  `
    )
    .join("");

  prevBtn.disabled = changelogPage <= 1;
  nextBtn.disabled = changelogPage >= totalPages;
}

function loadUpdates() {
  document.getElementById("version-label").textContent = APP_VERSION;

  renderInstallStatus();
  window.addEventListener("klcsh:install-available", renderInstallStatus);
  window.addEventListener("klcsh:installed", renderInstallStatus);

  renderChangelog();
  document.getElementById("changelog-prev-page").addEventListener("click", () => {
    changelogPage -= 1;
    renderChangelog();
  });
  document.getElementById("changelog-next-page").addEventListener("click", () => {
    changelogPage += 1;
    renderChangelog();
  });
}
