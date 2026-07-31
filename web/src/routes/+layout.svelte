<script lang="ts">
  import '../app.css';
  import { afterNavigate, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { themePreference, type Theme } from '$lib/theme.svelte';

  let { children } = $props();

  const options: { value: Theme; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
  ];

  /**
   * Put the address bar back where the rendered page actually is.
   *
   * SvelteKit only writes the history entry for navigations it pushed itself:
   * `navigate()` recurses with the same `popped` object when a `load` throws
   * `redirect()`, and the history write below it is behind `if (!popped)`. So a
   * Back onto a route whose guard bounces renders the redirect target under the
   * URL you popped to - the greeting at `/login`, or the login form at `/`.
   * Cosmetic, since the content always matches the real auth state, but an
   * address bar that lies is still a lie.
   *
   * The mismatch itself is the condition, rather than
   * `navigation.type === 'popstate'`. What we want to hold is "the URL names the
   * page you're looking at"; checking for a popstate would only restate the
   * framework internals that happen to break it today.
   *
   * `replaceState` from `$app/navigation`, not `history.replaceState`: SvelteKit
   * keeps its history and navigation indices in each entry's state and reads
   * them back in its own popstate listener, which falls through to a URL-only
   * update when they're absent. A raw call would have to reconstruct that state
   * object by hand; this one does it for us, keeping the current indices and
   * recording the corrected URL for the next time we land on this entry.
   */
  afterNavigate(() => {
    if (page.url.href === location.href) return;
    replaceState(page.url, page.state);
  });
</script>

<div class="min-h-screen bg-base-100 text-base-content">
  <!--
    Fixed rather than in a header bar, because both pages are full-height heros
    and neither has a chrome to hang this off. `pointer-events-none` on the
    wrapper keeps the empty space around the select from swallowing clicks meant
    for the page underneath - the auth suite clicks a centred form, and a stray
    invisible overlay is a miserable thing to debug.
  -->
  <div class="pointer-events-none fixed top-3 right-3 z-10">
    <select
      class="select select-sm pointer-events-auto"
      aria-label="Theme"
      bind:value={() => themePreference.value, (next) => themePreference.set(next)}
    >
      {#each options as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </div>

  {@render children()}
</div>
