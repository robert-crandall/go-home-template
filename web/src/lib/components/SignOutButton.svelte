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
  Its own component rather than markup inside `AppShell`, which is otherwise
  layout and nothing else. It lives in the shell footer because signing out is
  chrome - a page shouldn't have to remember to offer it.

  One root element, not a button and a sibling alert: the footer lays its
  children out in a flex *row*, so two roots would put the error beside the
  theme picker and squash both. One root keeps the failure stacked under the
  button no matter what the parent's layout is.
-->
<div class="flex flex-col items-end gap-2">
  <button type="button" class="btn btn-sm" onclick={logOut} disabled={busy}>Log out</button>

  {#if error}
    <!--
      `alert alert-error` rather than `text-error`, which measures ~2.8:1 on
      `base-100` and fails AA as body text. See D5 in docs/tech-stack.md.
    -->
    <div role="alert" class="alert alert-error text-sm">
      <span>{error}</span>
    </div>
  {/if}
</div>
