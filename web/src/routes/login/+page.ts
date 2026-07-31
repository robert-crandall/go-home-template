import { redirect } from '@sveltejs/kit';
import { api } from '$lib/api/client';
import { auth } from '$lib/auth.svelte';

/** The inverse of the guard on `/`: someone already signed in has no business
 *  on the login page. */
export async function load() {
  await auth.ensure();
  if (auth.user) redirect(307, '/');

  // Only asked for someone who is actually going to see the form - hence after
  // the redirect. Advisory state: under the default gate the register handler
  // re-checks under a lock, so this page can lose the race and has to render
  // the resulting error rather than assume it can't happen.
  //
  // Falling back to closed is the useful direction when the call fails: login
  // is the case for the whole life of a single-account app, and offering a
  // registration the server would refuse anyway helps nobody. Both failure
  // shapes land there. openapi-fetch resolves rather than throwing on a non-2xx
  // and leaves `data` undefined, so the `??` covers a refusal; the `catch` is
  // for the network itself failing, which it does throw for.
  let registrationOpen = false;
  try {
    const { data } = await api.GET('/api/app');
    registrationOpen = data?.registrationOpen ?? false;
  } catch {
    // Server unreachable. Same fallback.
  }

  return { registrationOpen };
}
