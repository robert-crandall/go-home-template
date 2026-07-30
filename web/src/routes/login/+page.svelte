<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client';
  import { apiErrorMessage } from '$lib/api/errors';
  import { auth } from '$lib/auth.svelte';

  let mode = $state<'login' | 'register'>('login');
  let email = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    busy = true;
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const { data, error: failure } = await api.POST(path, { body: { email, password } });
      if (failure || !data) {
        // Whatever the server said, verbatim. See $lib/api/errors.
        error = apiErrorMessage(failure);
        return;
      }
      auth.signedIn(data);
      await goto('/');
    } catch {
      error = 'Could not reach the server.';
    } finally {
      busy = false;
    }
  }

  function switchTo(next: 'login' | 'register') {
    mode = next;
    error = '';
  }
</script>

<main class="hero min-h-screen">
  <div class="hero-content w-full max-w-sm">
    <div class="card w-full bg-base-200 shadow-xl">
      <div class="card-body">
        <div role="tablist" class="tabs tabs-box mb-2">
          <button
            type="button"
            role="tab"
            class="tab"
            class:tab-active={mode === 'login'}
            aria-selected={mode === 'login'}
            onclick={() => switchTo('login')}>Log in</button
          >
          <button
            type="button"
            role="tab"
            class="tab"
            class:tab-active={mode === 'register'}
            aria-selected={mode === 'register'}
            onclick={() => switchTo('register')}>Register</button
          >
        </div>

        <form onsubmit={submit} novalidate={false}>
          <label class="label" for="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autocomplete="email"
            class="input input-bordered w-full"
            bind:value={email}
          />

          <label class="label mt-3" for="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minlength="8"
            autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
            class="input input-bordered w-full"
            bind:value={password}
          />

          {#if error}
            <div role="alert" class="alert alert-error mt-4">
              <span>{error}</span>
            </div>
          {/if}

          <button type="submit" class="btn btn-primary mt-5 w-full" disabled={busy}>
            {mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  </div>
</main>
