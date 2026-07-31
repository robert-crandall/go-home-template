<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/state';
  import { appName } from '$lib/app';
  import { isCurrent, navItems } from '$lib/nav';
  import ThemePicker from './ThemePicker.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<!--
  The chrome every page behind the guard sits inside: a sidebar on desktop, a
  header and a bottom bar on phones. All three read `navItems`, so adding a
  destination is one line in `$lib/nav` and nothing here.

  One component rather than a file per region. It is short enough to read in one
  go, and splitting it would mean four files that only ever appear together.

  Both navs carry `aria-label="Primary"`, which would be a duplicate landmark
  name if they were ever exposed at once. They can't be: each is `display: none`
  at the other's width, which takes it out of the accessibility tree entirely.
-->
<div class="flex min-h-screen">
  <div class="hidden w-60 shrink-0 flex-col border-r border-base-300 lg:flex">
    <div class="border-b border-base-300 px-5 py-4">
      <span class="block truncate text-lg font-bold tracking-tight">{appName}</span>
    </div>

    <nav class="flex flex-1 flex-col gap-1 p-3" aria-label="Primary">
      {#each navItems as item (item.href)}
        {@const current = isCurrent(item, page.url.pathname)}
        <a
          href={item.href}
          aria-current={current ? 'page' : undefined}
          class="rounded-lg px-3 py-2 text-sm {current
            ? 'bg-base-200 font-semibold text-base-content'
            : 'font-normal text-base-content/60 hover:bg-base-200'}"
        >
          {item.label}
        </a>
      {/each}
    </nav>

    <!--
      The picker sits at the foot of the column rather than beside the app name:
      a 240px sidebar can't hold a long app name and a select on one row, and
      the thing that would give way is the name.
    -->
    <div class="border-t border-base-300 px-3 py-3">
      <ThemePicker />
    </div>
  </div>

  <div class="flex min-w-0 flex-1 flex-col">
    <header
      class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-base-300 bg-base-100 px-4 py-2.5 lg:hidden"
    >
      <span class="truncate text-lg font-bold tracking-tight">{appName}</span>
      <ThemePicker />
    </header>

    <main class="flex-1 p-5 lg:p-8">
      {@render children()}
    </main>

    <!--
      No fixed number of slots, and nothing behind an overflow menu: the items
      divide whatever width there is, `min-w-0` lets them shrink, and the label
      truncates. So more destinations than fit comfortably is a legibility
      degradation - shorter labels, glyphs still telling them apart - rather
      than a destination that scrolled off the edge and can't be found.

      The current item is marked by weight, full-strength text, and a primary
      top edge rather than by `text-primary`: on dark `base-100` that color is
      3.4:1, which is fine for the edge (a non-text marker needs 3:1) and short
      of AA for the label itself. Same reason the sidebar marks with a filled
      row. See D5 in docs/tech-stack.md.
    -->
    <nav
      class="sticky bottom-0 z-10 flex border-t border-base-300 bg-base-100 lg:hidden"
      aria-label="Primary"
    >
      {#each navItems as item (item.href)}
        {@const current = isCurrent(item, page.url.pathname)}
        <a
          href={item.href}
          aria-current={current ? 'page' : undefined}
          class="flex min-w-0 flex-1 flex-col items-center gap-0.5 border-t-2 px-1 py-2 text-[11px] {current
            ? 'border-primary font-semibold text-base-content'
            : 'border-transparent text-base-content/60'}"
        >
          <span class="text-base leading-none" aria-hidden="true">{item.icon}</span>
          <span class="w-full truncate text-center">{item.label}</span>
        </a>
      {/each}
    </nav>
  </div>
</div>
