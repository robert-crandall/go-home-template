/**
 * Which theme the person picked, and nothing more.
 *
 * The value stored here is the *preference* - `system`, `light`, or `dark` - not
 * the theme currently on screen. That distinction is what keeps this file small:
 * in `system` mode nothing is written to the document at all, and daisyUI's
 * `--prefersdark` handles it in pure CSS through a rule scoped to
 * `:root:not([data-theme])`. So there is no `matchMedia` here, no listener for
 * the OS flipping mid-session, and no "effective theme" to derive - the browser
 * already does that job, and does it live.
 *
 * The other half of this lives in `app.html`, as an inline script that applies
 * the stored choice before the app boots. Without it the page paints the light
 * default for a frame and then snaps to dark.
 */

const KEY = 'theme';

export type Theme = 'system' | 'light' | 'dark';

/**
 * Storage can be unavailable rather than merely empty - Safari's private mode
 * and cookie-blocking settings both make `localStorage` throw on access. The
 * right answer there is "follow the system theme", not an error on every page
 * load, so both read and write swallow it.
 */
function read(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Storage blocked. Fall through to the default.
  }
  return 'system';
}

// Safe at module scope: `+layout.ts` sets `ssr = false`, so nothing in this app
// evaluates outside a browser.
let theme = $state<Theme>(read());

export const themePreference = {
  get value() {
    return theme;
  },

  set(next: Theme) {
    theme = next;

    // `system` removes the attribute rather than setting one, which is what
    // hands the decision back to the media query.
    if (next === 'system') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = next;
    }

    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage blocked, so the choice lasts for this page only. Applying it
      // above still worked, which is the part the person can see.
    }
  }
};
