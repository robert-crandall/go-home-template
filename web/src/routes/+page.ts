import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/auth.svelte';

/**
 * Guard the page from `load` rather than from the component. SvelteKit does not
 * render the component until `load` resolves, so a signed-out visitor gets a
 * redirect instead of a flash of the greeting.
 */
export async function load() {
  await auth.ensure();
  if (!auth.user) redirect(307, '/login');
  return { user: auth.user };
}
