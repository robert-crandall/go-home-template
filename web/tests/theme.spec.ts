import { expect, test, type Page } from '@playwright/test';

/**
 * Theme switching and the install metadata, against the real binary.
 *
 * Two tests. The theme one is a single sequential test, like the auth suite,
 * because its claims build on each other: a choice made in one step has to
 * survive the reload, restart, and deep link in the ones after it. The metadata
 * one is separate because it shares no state with any of that - it's a handful
 * of independent HTTP assertions plus Chrome's own manifest parser.
 *
 * Nothing here registers or logs in, so the file shares the database with
 * `auth.spec.ts` without caring what state that leaves behind.
 *
 * `/login` is the page throughout: it's reachable signed out, and it's a deep
 * link, so the Go binary's SPA fallback is in the path every time.
 */

// Pinned rather than inherited, so "no stored choice looks light" is a fact
// about the app and not a fact about whoever's laptop is running the suite.
test.use({ colorScheme: 'light' });

const themeSelect = (page: Page) => page.getByLabel('Theme');
const documentTheme = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset.theme ?? null);
const bodyBackground = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const storedTheme = (page: Page) => page.evaluate(() => localStorage.getItem('theme'));

test('a chosen theme applies before the app boots, and survives reload, restart, and a deep link', async ({
  page,
  context,
  browser
}) => {
  let light = '';
  let dark = '';

  await test.step('with no stored choice, the OS decides - in CSS, with no attribute', async () => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();

    expect(await documentTheme(page), 'an unasked visitor should not have a theme forced on them').toBe(
      null
    );
    light = await bodyBackground(page);

    // daisyUI's `--prefersdark` is scoped to `:root:not([data-theme])`, so with
    // no attribute the OS preference is a live media query rather than
    // something JavaScript resolved once at boot. Flipping it mid-session is
    // the cheapest way to show that's really what's happening.
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await bodyBackground(page), 'the OS preference should still be in force').not.toBe(light);
    expect(await documentTheme(page)).toBe(null);
    await page.emulateMedia({ colorScheme: 'light' });
  });

  await test.step('choosing dark applies it and remembers it', async () => {
    await themeSelect(page).selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await storedTheme(page)).toBe('dark');

    dark = await bodyBackground(page);
    expect(dark, 'dark should not look like light').not.toBe(light);
  });

  await test.step('a reload comes back dark', async () => {
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(themeSelect(page)).toHaveValue('dark');
  });

  await test.step('the theme is right with no application JavaScript at all', async () => {
    // This is the "no flash of the wrong theme" criterion, and it's measured by
    // removing the only thing that could paper over a failure. Every external
    // script request is aborted, so nothing hydrates and nothing re-applies the
    // theme late; inline scripts still run, which is the point - the one in
    // app.html is what's on trial. If the page is dark anyway, that script did
    // it before the first paint. CSS is allowed through, which is what makes
    // the colour check mean something.
    //
    // Measured, not assumed, in two probes:
    //
    //   - Deleting the inline script from app.html fails the *reload* step
    //     first, because nothing else in this app applies a stored theme.
    //   - So the sharper probe is the realistic wrong implementation: leave the
    //     inline script out and have theme.svelte.ts apply the theme after
    //     hydration instead. Then the reload step passes - and this step is the
    //     only one in the file that fails. That difference is the flash.
    //
    // Two things make the abort non-vacuous, and they check different halves:
    //
    //   - At least one blocked URL is under `_app/immutable/entry/`, which is
    //     the app's boot pair (`start` and `app`, imported dynamically from a
    //     script in <body>). Counting aborts alone would be satisfied by any
    //     stray `.js` while the app booted normally underneath.
    //   - The theme picker isn't in the DOM. It only exists once Svelte mounts
    //     the layout, so its absence is direct evidence that no application
    //     code ran - not an inference from what the network did.
    const abortedUrls: string[] = [];
    await page.route('**/*.js', (route) => {
      abortedUrls.push(route.request().url());
      return route.abort();
    });

    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    expect(
      abortedUrls.filter((url) => url.includes('/_app/immutable/entry/')),
      "the app's entry chunks were not blocked, so this step proved nothing"
    ).not.toHaveLength(0);
    await expect(themeSelect(page), 'the app mounted, so this is not a no-JS page').toHaveCount(0);

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // Compared against the value recorded above rather than a literal: daisyUI
    // emits oklch(), and how a browser serializes that is not this suite's
    // business. toHaveCSS rather than a one-shot getComputedStyle read because
    // domcontentloaded doesn't wait on stylesheets, so a slow CSS response
    // would otherwise be measured as the wrong background instead of as a
    // not-yet-arrived one.
    await expect(page.locator('body')).toHaveCSS('background-color', dark);

    await page.unroute('**/*.js');
  });

  await test.step('the choice survives a browser restart', async () => {
    // A new context with the saved storage, which is what a restart is. A
    // reload would only prove the page didn't forget mid-session.
    const restarted = await browser.newContext({
      storageState: await context.storageState(),
      colorScheme: 'light'
    });
    try {
      const afterRestart = await restarted.newPage();
      await afterRestart.goto('/login');
      await expect(afterRestart.locator('html')).toHaveAttribute('data-theme', 'dark');
    } finally {
      await restarted.close();
    }
  });

  await test.step('a deep link opened in a new tab is themed', async () => {
    const tab = await context.newPage();
    try {
      await tab.goto('/login');
      await expect(tab.locator('html')).toHaveAttribute('data-theme', 'dark');
    } finally {
      await tab.close();
    }
  });

  await test.step('going back to System hands the decision to the OS again', async () => {
    await page.goto('/login');
    await themeSelect(page).selectOption('system');
    expect(await documentTheme(page), 'System means no attribute, not an attribute saying "system"').toBe(
      null
    );
    expect(await storedTheme(page)).toBe('system');
    expect(await bodyBackground(page)).toBe(light);
  });
});

test('the app ships install metadata the browser can read', async ({ page, context }) => {
  await page.goto('/login');

  await test.step('the manifest and its icons are real files, not the SPA fallback', async () => {
    // The Go server answers any path it can't find with index.html and a 200,
    // so "the request succeeded" proves nothing on its own. The content type is
    // what separates a manifest from a page pretending to be one.
    const response = await page.request.get('/manifest.webmanifest');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/manifest+json');

    const manifest = await response.json();
    expect(manifest.name).toBeTruthy();
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512'])
    );

    for (const icon of manifest.icons as { src: string }[]) {
      const image = await page.request.get(icon.src);
      expect(image.status(), `${icon.src} should exist`).toBe(200);
      expect(image.headers()['content-type'], `${icon.src} should be a PNG`).toContain('image/png');
    }
  });

  await test.step('Chrome itself parses it without complaint', async () => {
    // The same parser behind DevTools' Application > Manifest panel, which is
    // where the "is this install metadata complete" question actually gets
    // answered. The url and data assertions come first on purpose: an empty
    // error list from a browser that never found a manifest would be the most
    // convincing vacuous pass in this suite.
    const cdp = await context.newCDPSession(page);
    try {
      const result = await cdp.send('Page.getAppManifest');
      expect(result.url).toContain('/manifest.webmanifest');
      expect(result.data ?? '').toContain('"name"');
      expect(result.errors).toEqual([]);
    } finally {
      await cdp.detach();
    }
  });
});
