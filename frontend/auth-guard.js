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

  Paths here are root-absolute ("/account/login.html") rather
  than relative ("login.html") on purpose — this file gets
  included from pages at different folder depths (index.html
  at the root, contributions.html under transactions/), and a
  relative redirect would resolve differently depending on
  which page loaded it.

  requireAuth() is also where a first-time profile finally gets
  created — see finishPendingProfile() below for why it lives
  here instead of in auth-login.js.
  --------------------------------------------------------
*/

async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session || !session.user.email_confirmed_at) {
    window.location.href = "/account/login.html";
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
  in: an avatar button that toggles a dropdown (Settings / Sign
  out — profile editing lives inside Settings). Looks up `gender`
  to pick the right icon — that's a plain, non-sensitive column,
  readable under the same "profiles are viewable by all logged-in
  users" policy everything else on the page already relies on.
*/
async function renderAccountNav(user) {
  const slot = document.getElementById("header-account");
  if (!slot) return;

  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("gender")
    .eq("id", user.id)
    .single();

  const gender = profile ? profile.gender : "other";

  slot.innerHTML = `
    <div class="profile-menu">
      <button type="button" class="profile-icon-btn" id="profile-icon-btn"
              aria-haspopup="true" aria-expanded="false" aria-label="Account menu">
        ${avatarSvg(gender)}
      </button>
      <div class="profile-dropdown" id="profile-dropdown" role="menu" hidden>
        <a href="/user/settings.html" role="menuitem">Settings</a>
        <button type="button" id="sign-out-btn" role="menuitem">Sign out</button>
      </div>
    </div>
  `;

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
    window.location.href = "/account/login.html";
  });
}
