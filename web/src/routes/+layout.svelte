<script lang="ts">
  import '../app.css';
  import { themePreference, type Theme } from '$lib/theme.svelte';

  let { children } = $props();

  const options: { value: Theme; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
  ];
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
