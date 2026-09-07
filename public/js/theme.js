// Manual light/dark override, on top of the automatic prefers-color-scheme support every
// screen already has. Storing the choice as a `data-theme` attribute on <html> (not a class or
// JS-only state) is what lets tailwind.css's dark token overrides apply in three consistent
// ways: system preference by default, forced dark via [data-theme="dark"], and forced light via
// [data-theme="light"] (which works by *excluding* the system-dark override, not by redefining
// every token back to light -- see the :not([data-theme="light"]) guard in tailwind.css).
//
// The actual attribute is set synchronously by an inline <script> in <head>, before any CSS
// paints -- reading localStorage from this module (loaded as a deferred module script at the
// end of body) would happen too late and cause a flash of the wrong theme on load. This module
// just needs to agree on the same storage key and provide the toggle behavior once the page is
// interactive.
const STORAGE_KEY = "bgb_theme";

export function getEffectiveTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function toggleTheme() {
  const next = getEffectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private browsing / storage disabled -- the toggle still works for this page load via the
    // data-theme attribute, it just won't be remembered next visit.
  }
  return next;
}
