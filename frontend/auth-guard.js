/*
  AUTH-GUARD.JS
  --------------------------------------------------------
  Include this on any page that requires login (index.html,
  contributions.html, the user/ pages). It runs immediately,
  before the rest of the page's data-loading scripts, and
  bounces the visitor to login.html if they're not signed in
  and verified.

  Note: this is a UX convenience, not the real security
  boundary — someone could disable JavaScript and see the
  static HTML shell. The REAL protection is Row Level
  Security on the database, which we already set up: even
  if someone bypassed this guard, Supabase would refuse to
  hand back any data they're not allowed to see.

  Paths here are root-absolute ("/login") rather than relative
  ("login.html") on purpose — this file gets included from pages
  at different folder depths (index.html at the root,
  contributions.html under transactions/), and a relative
  redirect would resolve differently depending on which page
  loaded it. These are the pretty URLs from frontend/_redirects,
  not the real file paths — e.g. "/login" actually serves
  account/login.html underneath.

  requireAuth() is also where a first-time profile finally gets
  created — see finishPendingProfile() below for why it lives
  here instead of in auth-login.js.
  --------------------------------------------------------
*/

/*
  Belt-and-suspenders for the same bfcache problem frontend/_headers
  solves with Cache-Control: no-store. That header should stop
  browsers from bfcaching these pages at all, but if one does it
  anyway, "pageshow" firing with persisted=true means this exact DOM
  was just restored from bfcache rather than freshly loaded/executed
  — a straight reload forces a real navigation, which re-runs
  requireAuth() from scratch and bounces to /login if the session is
  gone (e.g. the user signed out, then hit Back).
*/
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    window.location.reload();
  }
});

/*
  Mobile nav toggle — a hamburger button (only visible under
  style.css's 640px breakpoint) that reveals a nav as a dropdown
  instead of whatever cramped/wrapping row there's no room for on a
  phone screen. Generic so it can wire up both the site's main nav
  (called below, unconditionally, same as the pageshow listener
  above — a no-op on pages without these elements, like admin pages
  or login/register) and the admin section's own secondary nav
  (called from admin-guard.js with different element ids).
*/
function wireNavToggle(btnId = "nav-toggle-btn", navId = "main-nav") {
  const btn = document.getElementById(btnId);
  const nav = document.getElementById(navId);
  if (!btn || !nav) return;

  function closeNav() {
    nav.classList.remove("is-open");
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = nav.classList.toggle("is-open");
    btn.setAttribute("aria-expanded", String(isOpen));
  });

  // Picking a link should close the dropdown too, not leave it
  // hanging open underneath whatever page loads next.
  nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeNav));

  document.addEventListener("click", (e) => {
    if (nav.classList.contains("is-open") && !nav.contains(e.target) && e.target !== btn) {
      closeNav();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeNav();
  });
}

wireNavToggle();

async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session || !session.user.email_confirmed_at) {
    window.location.href = "/login";
    return null;
  }

  await finishPendingProfile();

  return session.user;
}

/*
  Registration can't call create_profile() directly — this site
  requires email confirmation, and signUp() doesn't hand back a
  session until that's done, so auth.uid() has nothing to return
  yet. auth-register.js stashes what was typed in localStorage
  instead, meant to be picked up on first login.

  This used to live in auth-login.js's submit handler, but that
  only runs if the user actually fills in the login FORM. Supabase's
  confirmation email link can establish a session and redirect
  straight into the app without ever hitting that form — so the
  handoff has to live somewhere that's guaranteed to run once a
  session exists, no matter how they got one. requireAuth() runs
  on every protected page before anything else, which is exactly
  that guarantee.
*/
async function finishPendingProfile() {
  const pending = localStorage.getItem("pendingProfile");
  if (!pending) return;

  const fields = JSON.parse(pending);
  const { error } = await supabaseClient.rpc("create_profile", {
    p_in_game_name: fields.in_game_name,
    p_real_name: fields.real_name,
    p_discord_username: fields.discord_username,
  });

  // Don't throw on failure — if this doesn't work, the Settings
  // page's "no profile yet" fallback can still create it from
  // scratch. Just leave the stashed data in place so we try again
  // on the next page load instead of silently losing it.
  if (!error) localStorage.removeItem("pendingProfile");
}

/*
  A small blocky "bust" icon built from a handful of rectangles —
  head, hair, shoulders — in the same voxel style as the rest of
  the site. This is NOT a copy of any real Minecraft skin texture,
  just inspired by the blocky look, so it's safe to draw ourselves
  instead of using Mojang's actual Steve/Alex artwork.

  "male"/"female" get filled colors; anything else (including the
  default "other") gets an outline-only version, since no skin has
  been chosen yet.
*/
function avatarSvg(gender) {
  const skin = "#e0ac69";
  const styles = {
    male: { hair: "#3b2a1a", shirt: "#4fb3c9", sideHair: false },
    female: { hair: "#a34a28", shirt: "#8a5fd6", sideHair: true },
  };

  if (gender !== "male" && gender !== "female") {
    return `
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">
        <rect x="1" y="11" width="14" height="5" rx="1.5" />
        <rect x="6" y="9" width="4" height="3" />
        <rect x="3" y="2" width="10" height="8" rx="1.5" />
        <rect x="3" y="1" width="10" height="3" rx="1" />
      </svg>
    `;
  }

  const s = styles[gender];
  const sideHairBits = s.sideHair
    ? `<rect x="2" y="3" width="2" height="6" fill="${s.hair}" />
       <rect x="12" y="3" width="2" height="6" fill="${s.hair}" />`
    : "";

  return `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1" y="11" width="14" height="5" rx="1.5" fill="${s.shirt}" />
      <rect x="6" y="9" width="4" height="3" fill="${skin}" />
      <rect x="3" y="2" width="10" height="8" rx="1.5" fill="${skin}" />
      ${sideHairBits}
      <rect x="3" y="1" width="10" height="3" rx="1" fill="${s.hair}" />
    </svg>
  `;
}

/*
  Populates the header's account slot once we know who's logged
  in: a notification bell (unread count badge, dropdown, live
  updates via Realtime) and an avatar button that toggles its own
  dropdown (Settings / Sign out). Looks up `gender`/`role` — both
  plain, non-sensitive columns, readable under the same "profiles
  are viewable by all logged-in users" policy everything else on
  the page already relies on.
*/
async function renderAccountNav(user) {
  const slot = document.getElementById("header-account");
  if (!slot) return;

  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("gender, role")
    .eq("id", user.id)
    .single();

  const gender = profile ? profile.gender : "other";
  const isAdmin = profile ? profile.role === "admin" : false;

  slot.innerHTML = `
    <div class="header-account-inner">
      <div class="notification-bell">
        <button type="button" class="notification-icon-btn" id="notification-icon-btn"
                aria-haspopup="true" aria-expanded="false" aria-label="Notifications">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span class="notification-badge" id="notification-badge" hidden></span>
        </button>
        <div class="notification-dropdown" id="notification-dropdown" role="menu" hidden>
          <div class="notification-list" id="notification-list"></div>
        </div>
      </div>
      <div class="profile-menu">
        <button type="button" class="profile-icon-btn" id="profile-icon-btn"
                aria-haspopup="true" aria-expanded="false" aria-label="Account menu">
          ${avatarSvg(gender)}
        </button>
        <div class="profile-dropdown" id="profile-dropdown" role="menu" hidden>
          ${isAdmin ? `<a href="/admin/dashboard" role="menuitem">Admin Dashboard</a>` : ""}
          <a href="/my-contributions" role="menuitem">My Contributions</a>
          <a href="/shop" role="menuitem">Shop</a>
          <a href="/battlepass" role="menuitem">Battlepass</a>
          <a href="/updates" role="menuitem">Updates</a>
          <a href="/settings" role="menuitem">Settings</a>
          <button type="button" id="sign-out-btn" role="menuitem">Sign out</button>
        </div>
      </div>
    </div>
  `;

  wireProfileMenu();
  wireNotificationBell(user);
}

function wireProfileMenu() {
  const btn = document.getElementById("profile-icon-btn");
  const dropdown = document.getElementById("profile-dropdown");

  function closeDropdown() {
    dropdown.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !dropdown.hidden;
    dropdown.hidden = isOpen;
    btn.setAttribute("aria-expanded", String(!isOpen));
  });

  // Close on an outside click or Escape — standard dropdown manners.
  document.addEventListener("click", (e) => {
    if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== btn) {
      closeDropdown();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDropdown();
  });

  document.getElementById("sign-out-btn").addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "/login";
  });
}

/*
  The bell: loads the last 30 notifications once, keeps them in
  `notifications` (module-level to this function's closure via
  the outer variable below), re-renders the list + badge on every
  change, and subscribes to Realtime so a brand new notification
  shows up without a page reload. Marking read only happens when
  you click an individual notification — opening the dropdown
  itself doesn't mark anything read, by design.
*/
function wireNotificationBell(user) {
  let notifications = [];

  const btn = document.getElementById("notification-icon-btn");
  const dropdown = document.getElementById("notification-dropdown");
  const listEl = document.getElementById("notification-list");
  const badgeEl = document.getElementById("notification-badge");

  function renderBadge() {
    const unreadCount = notifications.filter(n => !n.read).length;
    if (unreadCount > 0) {
      badgeEl.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
      badgeEl.hidden = false;
    } else {
      badgeEl.hidden = true;
    }
  }

  function renderList() {
    listEl.innerHTML = notifications.length === 0
      ? `<div class="notification-empty">Nothing yet.</div>`
      : notifications.map(n => `
          <button type="button" class="notification-item ${n.read ? "" : "notification-item--unread"}" data-notif-id="${n.id}">
            <span class="notification-message">${escapeHtml(n.message)}</span>
            <span class="notification-time">${formatDateTime(n.created_at)}</span>
          </button>
        `).join("");

    listEl.querySelectorAll("[data-notif-id]").forEach(item => {
      item.addEventListener("click", () => markNotificationRead(item.dataset.notifId));
    });

    renderBadge();
  }

  async function markNotificationRead(id) {
    const notif = notifications.find(n => n.id === id);
    if (!notif || notif.read) return;

    notif.read = true;
    renderList(); // optimistic — feels instant, worth it for a one-column flag flip

    const { error } = await supabaseClient.from("notifications").update({ read: true }).eq("id", id);
    if (error) {
      notif.read = false; // put it back if the save actually failed
      renderList();
    }
  }

  function closeDropdown() {
    dropdown.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !dropdown.hidden;
    dropdown.hidden = isOpen;
    btn.setAttribute("aria-expanded", String(!isOpen));
  });

  document.addEventListener("click", (e) => {
    if (!dropdown.hidden && !dropdown.contains(e.target) && e.target !== btn) {
      closeDropdown();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDropdown();
  });

  (async () => {
    const { data } = await supabaseClient
      .from("notifications")
      .select("id, type, message, read, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30);

    notifications = data || [];
    renderList();
  })();

  // Live updates — a new row for this user shows up immediately
  // without needing to reload the page.
  supabaseClient
    .channel(`notifications:${user.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
      (payload) => {
        notifications = [payload.new, ...notifications];
        renderList();
      }
    )
    .subscribe();
}
