import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/auth.svelte';

/** The inverse of the guard on `/`: someone already signed in has no business
 *  on the login page. */
export async function load() {
  await auth.ensure();
  if (auth.user) redirect(307, '/');
}
