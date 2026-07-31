<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client';
  import { apiErrorMessage } from '$lib/api/errors';
  import { auth } from '$lib/auth.svelte';

  let { data } = $props();
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

<div class="max-w-2xl">
  <h1 class="text-3xl font-bold lg:text-4xl">Hello</h1>
  <p class="py-4">
    Signed in as <span class="font-mono">{data.user.email}</span>. The API and this page are served
    by the same Go binary on the same port.
  </p>
  <button type="button" class="btn btn-primary" onclick={logOut} disabled={busy}>Log out</button>

  {#if error}
    <div role="alert" class="alert alert-error mt-4">
      <span>{error}</span>
    </div>
  {/if}
</div>
