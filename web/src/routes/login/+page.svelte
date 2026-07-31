<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client';
  import { apiErrorMessage } from '$lib/api/errors';
  import { auth } from '$lib/auth.svelte';
  import ThemePicker from '$lib/components/ThemePicker.svelte';

  let { data } = $props();

  // Only the explicit choice is state; the data decides the rest. Closed wins
  // outright, so a `load` that re-runs and comes back closed can't leave a
  // register form behind a toggle that is no longer on screen. Open opens on
  // Register, because that's the thing to do at that moment.
  let chosen = $state<'login' | 'register' | null>(null);
  const mode = $derived(data.registrationOpen ? (chosen ?? 'register') : 'login');
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
    chosen = next;
    error = '';
  }
</script>

<!--
  Fixed rather than in a header bar: this page is a full-height hero outside the
  shell, so there is no chrome to hang the picker off. A signed-out visitor gets
  to pick a theme too.

  The wrapper is `fixed` with no width, so it shrinks to the select and covers
  nothing else - the auth suite clicks a centred form right underneath it, which
  is what keeps that honest.
-->
<div class="fixed top-3 right-3 z-10">
  <ThemePicker />
</div>

<main class="hero min-h-screen">
  <div class="hero-content w-full max-w-sm">
    <div class="card w-full bg-base-200 shadow-xl">
      <div class="card-body">
        <!--
          Only when registration is open. Closed is the steady state for a
          single-account app, and a Register control that can only ever produce
          "registration is closed" is a dead end - see the load function.

          It stays a pair rather than becoming "the register form" because
          ALLOW_OPEN_REGISTRATION=true holds this open forever, and an app in
          that mode still needs a way to log in. One bool can't tell "open
          because there's no account yet" from "open because it's configured
          that way", and it doesn't need to: defaulting to Register while
          leaving Log in reachable is right for both.

          These look like daisyUI tabs but they are not tabs: there is one form
          below, not a panel per tab. Real tab roles would promise arrow-key
          navigation and aria-controls that do not exist here, which is worse
          for a screen reader than no ARIA at all. Two buttons, aria-pressed.
        -->
        {#if data.registrationOpen}
          <div class="tabs tabs-box mb-2" role="group" aria-label="Log in or register">
            <button
              type="button"
              class="tab"
              class:tab-active={mode === 'login'}
              aria-pressed={mode === 'login'}
              onclick={() => switchTo('login')}>Log in</button
            >
            <button
              type="button"
              class="tab"
              class:tab-active={mode === 'register'}
              aria-pressed={mode === 'register'}
              onclick={() => switchTo('register')}>Register</button
            >
          </div>
        {/if}

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
