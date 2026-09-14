<script lang="ts">
  import SignOutButton from '$lib/components/SignOutButton.svelte';
  import ThemePicker from '$lib/components/ThemePicker.svelte';

  let { data } = $props();
</script>

<!--
  The one example page, and the only thing behind the guard. It exists to prove
  a session works end to end - you are signed in, here is who you are, here is
  the way out - and it is meant to be replaced by whatever your app actually is.

  Sign-out lives here rather than in a layout on purpose. Chrome that offers it
  on every page would be this template deciding your app has a sidebar or a
  header, which is the decision it is trying not to make. `(app)/+layout.ts` is
  a guard with no component beside it, so pages inherit a session and nothing
  else. Move `SignOutButton` into a layout of your own once you know what your
  chrome looks like.
-->
<main class="p-page">
  <h1>Hello</h1>
  <p class="mt-inline max-w-copy">
    You're signed in as {data.user.email}. The API and this page are served by the same Go binary on
    the same port.
  </p>
  <div class="mt-section">
    <SignOutButton />
  </div>
  <div class="mt-section">
    <ThemePicker />
  </div>
</main>
