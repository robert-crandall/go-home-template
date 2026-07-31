<script lang="ts">
  import '../app.css';
  import { updated } from '$app/state';
  import { themePreference, type Theme } from '$lib/theme.svelte';

  let { children } = $props();

  const options: { value: Theme; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
  ];

  // Pick up a deploy without asking. `version.pollInterval` in svelte.config.js
  // flips `updated.current` when the server's `_app/version.json` stops matching
  // the version baked into this bundle; polling never reloads by itself, so
  // this is the half that acts on it.
  //
  // The reload is unconditional, which is a judgement about this app and not a
  // universal truth: nothing here holds unsaved state worth protecting - the
  // login form is the only input on either page. An app that grows a real form
  // should gate this on the form being clean rather than prompt, since a "new
  // version available, tap to refresh" banner is the thing this exists to
  // avoid.
  $effect(() => {
    if (updated.current) location.reload();
  });

  // Latency, not correctness: the poll above already lands every case within an
  // interval once the page's JavaScript is running again. But an installed PWA
  // resumed from the iOS app switcher would show the old UI for up to a minute
  // and then reload under you, which is worse than reloading at the moment you
  // came back. `updated.check()` forces an immediate check regardless of
  // polling and sets the same store, so this is a shortcut into the mechanism
  // above rather than a second one.
  //
  // Deliberately no `pageshow`/`persisted` or `window.focus` listener. Those
  // cover real lifecycle paths this one misses (bfcache restore; switching to
  // another desktop app, which doesn't change visibilityState) - but a frozen
  // page's timers are paused, not deleted, so the poll recovers those on its
  // own and the extra listeners would only shave latency further.
  $effect(() => {
    const check = () => {
      if (document.visibilityState === 'visible') void updated.check();
    };
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
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
