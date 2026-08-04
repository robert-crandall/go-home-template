<script lang="ts">
  import { themePreference, type Theme } from '$lib/theme.svelte';

  // The order the button walks, and the only place the cycle is written down.
  const order: Theme[] = ['system', 'light', 'dark'];
  const labels: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

  const current = $derived(themePreference.value);
  const next = $derived(order[(order.indexOf(current) + 1) % order.length]);

  // An icon on its own says what you're on and nothing about what pressing it
  // does, which is the standing weakness of a cycling control. The accessible
  // name carries both halves, and `title` repeats it for a mouse.
  const label = $derived(`Theme: ${labels[current]}. Activate for ${labels[next]}.`);
</script>

<!--
  Three states rather than the usual sun/moon pair, because System is the one
  that matters: it means *no* `data-theme` attribute, which is what lets daisyUI
  pick the palette in pure CSS and keep following the OS live. A two-state
  toggle would have to resolve the OS preference into a stored light/dark, and
  that costs both a `matchMedia` call and the live following. See D5.

  No positioning here on purpose: the shell puts this in its chrome, and
  /login - which has no chrome - pins it to the corner itself.
-->
<button
  type="button"
  class="btn btn-square btn-ghost btn-sm"
  aria-label={label}
  title={label}
  onclick={() => themePreference.set(next)}
>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    class="size-5"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#if current === 'system'}
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    {:else if current === 'light'}
      <circle cx="12" cy="12" r="4" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
      />
    {:else}
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    {/if}
  </svg>
</button>
