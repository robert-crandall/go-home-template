import { expect, test, type Page } from '@playwright/test';

/**
 * A deploy reaching a client that is already running, against the real binary.
 *
 * The mechanism has two halves and they're useless apart: `version.pollInterval`
 * in svelte.config.js makes SvelteKit re-fetch `_app/version.json` on a timer
 * and flip `updated.current` when it stops matching the version baked into the
 * running bundle, and an effect in `+layout.svelte` reloads on that. Polling
 * alone changes nothing a user can see.
 *
 * A deploy is faked by answering `_app/version.json` with a different version,
 * which is exactly what a new binary serves. That's answered once and then
 * handed back to the real server, so the page that reloads sees the truth and
 * doesn't loop.
 *
 * Reloads are counted with the `load` event rather than by looking for a marker
 * on `window`, so nothing has to be evaluated in a document that may be tearing
 * down underneath the call.
 */

const NEXT_VERSION = '{"version":"pretend-this-is-a-new-deploy"}';

/**
 * Answers the next version check with `body`, then gets out of the way.
 * Returns a live count of checks that reached the route, which is what makes
 * the assertions below non-vacuous: a reload proves nothing unless the version
 * check that caused it happened when the test says it did.
 */
async function interceptVersionChecks(page: Page, body: string) {
  const checks = { count: 0 };
  let answered = false;
  await page.route('**/_app/version.json', async (route) => {
    checks.count += 1;
    if (answered) return route.continue();
    answered = true;
    return route.fulfill({ contentType: 'application/json', body });
  });
  return checks;
}

function countLoads(page: Page) {
  const loads = { count: 0 };
  page.on('load', () => (loads.count += 1));
  return loads;
}

test('a running client picks up a deploy on its own, with nobody touching it', async ({ page }) => {
  // The clock is installed before the first navigation so the poll SvelteKit
  // schedules is a timer this test can advance. That's the difference between
  // proving the timer exists and waiting a real minute for it: fast-forwarding
  // runs the app's own `setTimeout`, it doesn't stand in for it.
  await page.clock.install();

  const checks = await interceptVersionChecks(page, NEXT_VERSION);
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();

  const loads = countLoads(page);

  // Half of the non-vacuity: nothing has checked yet. Without this, a check
  // fired during boot would make the assertion after the fast-forward pass
  // whether or not `pollInterval` is configured at all - and with it left at
  // its default of 0, Vite drops the timer from the bundle entirely.
  expect(checks.count, 'a version check happened before any time passed').toBe(0);

  // Past the configured interval. Deliberately not exactly it: the assertion is
  // "this checks on its own", not "it checks at 60.000s".
  await page.clock.fastForward('02:00');

  await expect
    .poll(() => checks.count, { message: 'the poll never ran, so nothing could have noticed a deploy' })
    .toBeGreaterThan(0);
  await expect.poll(() => loads.count, { message: 'the app noticed a new version and stayed put' }).toBe(1);

  // And it settles. Not just "nothing else happened" - the reloaded page has to
  // keep checking and keep deciding not to reload, because a page that stopped
  // polling would look identical to one that correctly stayed put.
  await expect(page.getByLabel('Email')).toBeVisible();
  const checksAtReload = checks.count;
  await page.clock.fastForward('02:00');
  await expect
    .poll(() => checks.count, { message: 'the reloaded page stopped checking for deploys' })
    .toBeGreaterThan(checksAtReload);
  expect(loads.count, 'the app reloaded in a loop').toBe(1);
});

test('it only reloads when the version actually changed', async ({ page }) => {
  // The negative control for the test above. Same clock, same fast-forward, same
  // route interception - the only difference is that the server is still serving
  // the version this page was built from. If this reloads, the test above was
  // measuring "fast-forwarding the clock reloads the page" and nothing more.
  const current = await page.request.get('/_app/version.json');
  expect(current.status()).toBe(200);
  const unchanged = await current.text();

  await page.clock.install();
  const checks = await interceptVersionChecks(page, unchanged);
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();

  const loads = countLoads(page);
  await page.clock.fastForward('02:00');

  await expect.poll(() => checks.count, { message: 'the poll never ran, so this proved nothing' }).toBeGreaterThan(
    0
  );
  await page.waitForTimeout(500);
  expect(loads.count, 'the app reloaded despite being up to date').toBe(0);
});

test('returning to a backgrounded app checks immediately instead of waiting for the poll', async ({
  page
}) => {
  // What this covers: an installed PWA resumed from the iOS app switcher would
  // otherwise show the old UI for up to a poll interval and then reload under
  // you, which is worse than reloading at the moment you came back.
  //
  // The event is dispatched rather than produced by really backgrounding the
  // page, because in this Chromium there is no way to produce it. Measured:
  // opening a second page and calling `bringToFront()` on it leaves the first
  // page's `visibilityState` at "visible" and fires no `visibilitychange` at
  // all. So this proves the listener is wired to the same reload the poll uses.
  // It cannot prove iOS emits the event on resume - nothing runnable here can,
  // which is exactly why the poll and not this is the mechanism of record.
  //
  // No clock is installed and no time is advanced, so the poll cannot be what
  // reloads the page. The check count going 0 -> 1 across the dispatch is what
  // pins the reload on the listener.
  const checks = await interceptVersionChecks(page, NEXT_VERSION);
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();

  const loads = countLoads(page);
  expect(checks.count, 'something checked before the app was backgrounded').toBe(0);

  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  await expect
    .poll(() => checks.count, { message: 'coming back to the app checked nothing' })
    .toBeGreaterThan(0);
  await expect.poll(() => loads.count, { message: 'the app noticed a new version and stayed put' }).toBe(1);
  await expect(page.getByLabel('Email')).toBeVisible();
});
