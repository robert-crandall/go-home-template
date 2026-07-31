<script lang="ts">
  import { themePreference, type Theme } from '$lib/theme.svelte';

  const options: { value: Theme; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' }
  ];
</script>

<!--
  No positioning here on purpose: the shell puts this in its chrome, and
  /login - which has no chrome - pins it to the corner itself.

  `w-auto` because daisyUI's `.select` is full-width by default, which in a flex
  row means it takes the space and the app name next to it truncates.
-->
<select
  class="select select-sm w-auto"
  aria-label="Theme"
  bind:value={() => themePreference.value, (next) => themePreference.set(next)}
>
  {#each options as option (option.value)}
    <option value={option.value}>{option.label}</option>
  {/each}
</select>
