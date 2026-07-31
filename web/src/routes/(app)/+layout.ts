import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/auth.svelte';

/**
 * Guard the whole shell, from `load` rather than from a component. SvelteKit
 * does not render below a layout until its `load` resolves, so a signed-out
 * visitor gets a redirect instead of a flash of the page - `auth.spec.ts`
 * measures that with a MutationObserver rather than trusting it.
 *
 * On the layout, not on each page: every route in this group sits behind the
 * shell and therefore behind the session, so a copy of these five lines per
 * page would only be a chance to forget one.
 */
export async function load() {
  await auth.ensure();
  if (!auth.user) redirect(307, '/login');
  return { user: auth.user };
}
