<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client';
  import { apiErrorMessage } from '$lib/api/errors';
  import { auth } from '$lib/auth.svelte';

  let busy = $state(false);
  let error = $state('');

  async function logOut() {
    error = '';
    busy = true;
    try {
      const { error: failure } = await api.POST('/api/auth/logout');

      // The foundation refuses to clear the session cookie when it couldn't
      // revoke the session server-side - it would rather 500 than pretend a
      // live token is dead. Clearing local state here anyway would put that
      // pretense back: the button would look like it worked while the cookie
      // still logs you in on the next visit. So say what happened and stay put.
      if (failure) {
        error = apiErrorMessage(failure, 'Could not log out.');
        return;
      }

      auth.signOut();
      await goto('/login');
    } catch {
      // openapi-fetch lets a fetch-level rejection through, so without this the
      // button would sit disabled forever with nothing on screen.
      error = 'Could not reach the server.';
    } finally {
      busy = false;
    }
  }
</script>

<!--
  Its own component because signing out is behaviour, not layout: the refused
  logout above is the part worth keeping, and it should survive whatever chrome
  you build. `(app)/+page.svelte` renders it today.

  One root element, not a button and a sibling alert. Drop this into a layout
  that lays its children out in a row and two roots would put the failure
  *beside* the button rather than under it; the class-free wrapper keeps them
  stacked whatever the parent does, without picking a layout of its own.
-->
<div>
  <button
    type="button"
    class="btn"
    onclick={logOut}
    disabled={busy}
    aria-busy={busy}
  >
    {busy ? 'Logging out...' : 'Log out'}
  </button>

  {#if error}
    <p role="alert" class="alert alert-error mt-field">{error}</p>
  {/if}
</div>
