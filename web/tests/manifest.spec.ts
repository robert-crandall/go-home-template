import { expect, test } from '@playwright/test';

/**
 * The install metadata, against the real binary.
 *
 * This is the one visual-adjacent thing the template still ships, and it is
 * here because it is not really visual: a manifest the browser rejects means no
 * home-screen install, and the Go server answers any path it cannot find with
 * index.html and a 200, so a typo'd icon src looks fine from every angle except
 * the browser's.
 *
 * `/login` is the page, because it's reachable signed out and it's a deep link,
 * so the SPA fallback is in the path. Nothing here registers or logs in, so the
 * file shares the database with `auth.spec.ts` without caring what state that
 * leaves behind.
 */

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
