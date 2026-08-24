/*
  ADMIN-GUARD.JS
  --------------------------------------------------------
  Include this AFTER auth-guard.js on every admin page. First
  runs the normal login/verification check, then also confirms
  the signed-in user is an admin via the is_admin() database
  function, redirecting back to the homepage if not.

  Same note as auth-guard.js: this is a UX convenience, not the
  real security boundary. Every admin_* RPC function in
  database/04_admin_dashboard.sql checks is_admin() itself before
  doing anything — so even if someone bypassed this page-level
  check entirely, the database would still refuse to let a
  non-admin approve a payment or change someone's role.
  --------------------------------------------------------
*/

async function requireAdmin() {
  const user = await requireAuth();
  if (!user) return null; // requireAuth() already redirected to login

  const { data: isAdmin, error } = await supabaseClient.rpc("is_admin");

  // A real error (e.g. is_admin() doesn't exist yet because
  // database/04_admin_dashboard.sql hasn't been run) is a
  // different problem than "you're just not an admin" — surface
  // it instead of silently bouncing to the homepage either way.
  if (error) {
    alert("Couldn't check admin access: " + error.message);
    window.location.href = "/index.html";
    return null;
  }

  if (!isAdmin) {
    window.location.href = "/index.html";
    return null;
  }

  return user;
}
