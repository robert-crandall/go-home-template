/**
 * The app's display name, read from the one place it is already written down.
 *
 * `manifest.webmanifest`'s `name` is what the OS puts under the home-screen
 * icon, so it is *the* display name, and `make init` already rewrites it along
 * with the rest of the template's identity. Declaring the same string again in
 * TypeScript would be a third copy to keep in sync (the `<title>` in
 * `app.html` is the second) and one more thing for the rename to miss.
 *
 * Parsed at runtime rather than imported as JSON because the file's extension
 * is `.webmanifest`, which Vite's JSON handling doesn't claim. `?raw` inlines
 * the file's text into the bundle, so this is a single parse at module load and
 * no request.
 *
 * Worth knowing: `svelte-check` does *not* validate this path - `vite/client`
 * declares `*?raw` as a wildcard module, so `make check` passes over a typo and
 * the build is what fails. There is deliberately no fallback string; a fallback
 * would be the third copy this file exists to avoid. If the manifest has no
 * `name`, that is a broken manifest - the OS has nothing to label the icon
 * with either - so this says so instead of rendering an empty header.
 */
import manifest from '../../static/manifest.webmanifest?raw';

const { name } = JSON.parse(manifest) as { name?: unknown };

if (typeof name !== 'string' || name === '') {
  throw new Error('static/manifest.webmanifest has no "name": the app has no display name to show.');
}

export const appName: string = name;
