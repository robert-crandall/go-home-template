import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // index.html rather than SvelteKit's suggested 200.html: the Go server
    // serves the SPA from an embedded FS and looks for index.html at its root
    // (server.New panics without it). The prerendering conflict SvelteKit warns
    // about needs a route prerendered to /index.html, and nothing here
    // prerenders - ssr is off in the root layout and no route opts back in.
    adapter: adapter({ fallback: 'index.html' }),
    version: {
      // How a deploy reaches a client that is already running. Without this,
      // `pollInterval` is 0, Vite drops the timer from the bundle entirely, and
      // the only thing that ever re-checks is SvelteKit's own recovery path for
      // a client-side navigation that failed to import a chunk. A PWA resumed
      // from the iOS app switcher never navigates, so it would sit on the old
      // build indefinitely.
      //
      // What this does on its own is set `updated.current`. The reload lives in
      // `src/routes/+layout.svelte`; the two are useless apart.
      //
      // The polled file is `_app/version.json`, which the foundation serves
      // `no-cache` because it isn't under `_app/immutable/`, and which
      // SvelteKit additionally requests with a `cache-control: no-cache` header.
      // One ~30-byte request per minute per running client, against your own
      // server.
      pollInterval: 60_000
    }
  }
};

export default config;
