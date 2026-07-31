<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { appName } from '$lib/app';
  import { isCurrent, navSections } from '$lib/nav';
  import SignOutButton from './SignOutButton.svelte';
  import ThemePicker from './ThemePicker.svelte';

  let { children }: { children: Snippet } = $props();

  let drawer: HTMLDialogElement;
  // The drawer renders nothing until it is open. A closed `<dialog>` is
  // `display:none`, which keeps it out of the accessibility tree and away from
  // Playwright's *role* locators - but not from its text and CSS locators, and
  // `auth.spec.ts` reaches for the signed-in email with `getByText` and for the
  // login form with `locator('form')`. Not rendering means the DOM at rest has
  // exactly one of each, so the specs need no scoping to survive the drawer.
  let open = $state(false);

  const sections = $derived(navSections());
  const email = $derived(page.data.user?.email ?? '');

  async function openDrawer() {
    open = true;
    // So `showModal` has the links to move focus into.
    await tick();
    drawer.showModal();
  }

  // `<dialog>` gives us Escape, the backdrop, the focus trap and focus
  // restoration for free. The one thing it doesn't know about is client-side
  // navigation, so: close on link click, because tapping the link for the page
  // you are already on may not navigate at all, and close on `afterNavigate`,
  // which catches Back and Forward.
  afterNavigate(() => drawer?.close());
</script>

{#snippet navList(idPrefix: string)}
  <nav class="flex flex-col gap-1 p-3" aria-label="Primary">
    {#each sections as section, index (index)}
      {#if section.label}
        <!--
          The id carries the index as well as the sidebar/drawer prefix: two
          sections can legitimately share a label, since `navSections` groups
          consecutive runs rather than reordering.
        -->
        <h2
          id="{idPrefix}-section-{index}"
          class="px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-base-content/60 uppercase"
        >
          {section.label}
        </h2>
      {/if}
      <ul aria-labelledby={section.label ? `${idPrefix}-section-${index}` : undefined}>
        {#each section.items as item (item.href)}
          {@const current = isCurrent(item, page.url.pathname)}
          <li>
            <a
              href={item.href}
              aria-current={current ? 'page' : undefined}
              onclick={() => drawer?.close()}
              class="block rounded-lg px-3 py-2 text-sm {current
                ? 'bg-base-200 font-semibold text-base-content'
                : 'font-normal text-base-content/60 hover:bg-base-200'}"
            >
              {item.label}
            </a>
          </li>
        {/each}
      </ul>
    {/each}
  </nav>
{/snippet}

{#snippet footer()}
  <div class="border-t border-base-300 p-3">
    {#if email}
      <p class="truncate px-1 pb-2 text-sm text-base-content/60" title={email}>{email}</p>
    {/if}
    <div class="flex items-center justify-between gap-2">
      <ThemePicker />
      <SignOutButton />
    </div>
  </div>
{/snippet}

{#snippet brand()}
  <div class="border-b border-base-300 px-5 py-4">
    <span class="block truncate text-lg font-bold tracking-tight">{appName}</span>
  </div>
{/snippet}

<!--
  The chrome every page behind the guard sits inside: a sidebar on desktop, a
  header and a drawer on phones. Both navs come from the same snippet, which
  comes from `navItems`, so adding a destination is one line in `$lib/nav` and
  nothing here.

  One component rather than a file per region. It is short enough to read in one
  go, and splitting it would mean four files that only ever appear together.

  Both navs carry `aria-label="Primary"`, which would be a duplicate landmark
  name if they were ever exposed at once. They can't be: the sidebar is
  `display: none` below `lg`, and the drawer renders nothing until it opens.
-->
<div class="flex min-h-screen">
  <!--
    Sticky and full height so a long page scrolls under the shell rather than
    scrolling it away. The nav scrolls on its own if there are more destinations
    than fit; the footer stays put.
  -->
  <div
    class="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-base-300 lg:flex"
  >
    {@render brand()}
    <div class="flex-1 overflow-y-auto">
      {@render navList('sidebar')}
    </div>
    {@render footer()}
  </div>

  <div class="flex min-w-0 flex-1 flex-col">
    <header
      class="sticky top-0 z-10 flex items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-2.5 lg:hidden"
    >
      <button type="button" class="btn btn-square btn-ghost btn-sm" aria-label="Menu" aria-haspopup="dialog" onclick={openDrawer}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="size-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <span class="truncate text-lg font-bold tracking-tight">{appName}</span>
    </header>

    <main class="flex-1 p-5 lg:p-8">
      {@render children()}
    </main>
  </div>
</div>

<!--
  No `lg:hidden` here on purpose. Hiding an *open* modal - which is what
  rotating a tablet past the breakpoint would do - leaves an invisible thing
  holding focus. Left visible it's a drawer you can see and dismiss, and it is
  only ever opened from a button that `lg:hidden` has already taken away.
-->
<dialog bind:this={drawer} class="modal modal-start" onclose={() => (open = false)}>
  {#if open}
    <div class="modal-box flex w-72 flex-col rounded-none p-0">
      {@render brand()}
      <div class="flex-1 overflow-y-auto">
        {@render navList('drawer')}
      </div>
      {@render footer()}
    </div>
    <!-- daisyUI's click-outside close: a full-bleed submit button that closes
         the dialog with no JavaScript at all. -->
    <form method="dialog" class="modal-backdrop">
      <button>Close</button>
    </form>
  {/if}
</dialog>
