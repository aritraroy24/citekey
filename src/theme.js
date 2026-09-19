/* Applies the saved theme before the page paints.

   This is a classic script loaded in <head>, not a module: modules are deferred, which would let
   the page paint in the system theme first and flash when an explicit choice was applied. The
   choice is mirrored into localStorage (synchronous, extension-origin) so it is readable here;
   chrome.storage.sync remains the source of truth and reconciles a moment later. */

(() => {
  const STORAGE_KEY = "citekey.theme";
  const root = document.documentElement;

  const normalise = (theme) => (theme === "light" || theme === "dark" ? theme : "system");

  const apply = (theme) => {
    const value = normalise(theme);
    if (value === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (_) {
      /* private windows and blocked site data: the theme just falls back to the system one */
    }
    return value;
  };

  let cached = "system";
  try {
    cached = normalise(localStorage.getItem(STORAGE_KEY));
  } catch (_) {
    /* ignore */
  }
  apply(cached);

  window.citekeyTheme = { apply, cached: () => cached };
})();
