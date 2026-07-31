/**
 * The navigation model, defined once so the sidebar and the phone drawer can't
 * disagree about what exists or what it's called.
 *
 * **Adding a destination is one entry in this array.** Nothing in
 * `AppShell.svelte` holds its own copy of the route list, so a new page needs a
 * `+page.svelte` under `routes/(app)/` and a line here, and that's it.
 */
export type NavItem = {
  href: string;
  label: string;
  /**
   * Optional section header. Consecutive entries carrying the same group render
   * under one heading; an entry without a group renders on its own.
   *
   * A flat property rather than nested `{ label, items }` arrays on purpose:
   * with nested arrays a group has to exist before you can put a page in one,
   * and adding a destination becomes "one entry in one array, inside the right
   * group". The cost is that splitting a group with an entry in between renders
   * the header twice rather than merging - the order you write is the order you
   * get.
   */
  group?: string;
};

export const navItems: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/second', label: 'Second page', group: 'Examples' }
];

export type NavSection = {
  label?: string;
  items: NavItem[];
};

/**
 * Consecutive runs, not a `group by`, so nothing is reordered behind the
 * author's back. See the note on `NavItem.group`.
 */
export function navSections(items: NavItem[] = navItems): NavSection[] {
  const sections: NavSection[] = [];

  for (const item of items) {
    const open = sections.at(-1);
    if (open && open.label === item.group) open.items.push(item);
    else sections.push({ label: item.group, items: [item] });
  }

  return sections;
}

/**
 * Prefix matching, not the exact match you might reach for first: a section
 * with child routes - `/notes/123` under a `/notes` destination - should still
 * mark its destination. That is not nested navigation; the shell still renders
 * exactly one flat level.
 *
 * `/` is special-cased because it is a prefix of literally everything.
 *
 * There is no trailing-slash handling here on purpose. A deep link pasted as
 * `/second/` does reach the Go server, which serves the SPA fallback for it,
 * but SvelteKit's default `trailingSlash: 'never'` has already rewritten the
 * pathname to `/second` by the time anything renders - measured, not assumed.
 * `nav.spec.ts` links with the slash so that stays true.
 */
export function isCurrent(item: NavItem, pathname: string): boolean {
  if (item.href === '/') return pathname === '/';
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
