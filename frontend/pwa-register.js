/*
  PWA-REGISTER.JS
  --------------------------------------------------------
  Registers sw.js so the site is installable and keeps working if
  the connection drops mid-session. Included on every page via one
  <script> tag, same pattern as supabase-client.js.

  Also captures the browser's install prompt and holds onto it.
  Chrome/Edge fire "beforeinstallprompt" once, early, and hide it
  for good if preventDefault() isn't called synchronously — so it's
  stashed on window here, and the /updates page triggers it later
  whenever the user actually clicks "Download app", instead of
  relying on the browser's own address-bar icon.
  --------------------------------------------------------
*/

window.__deferredInstallPrompt = null;
window.__swRegistration = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  window.__deferredInstallPrompt = event;
  window.dispatchEvent(new CustomEvent("klcsh:install-available"));
});

window.addEventListener("appinstalled", () => {
  window.__deferredInstallPrompt = null;
  window.dispatchEvent(new CustomEvent("klcsh:installed"));
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        window.__swRegistration = registration;
      })
      .catch((error) => {
        console.error("Service worker registration failed:", error);
      });
  });
}
