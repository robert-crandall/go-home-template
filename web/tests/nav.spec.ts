import { expect, test, type Page } from '@playwright/test';
import { currentHref, navItems } from '../src/lib/nav';

/**
 * The navigation shell, against the real binary.
 *
 * Everything here is driven off `navItems`, so this file has no opinion about
 * what the destinations are: delete `/second`, add `/notes`, reorder them, drop
 * the one group - the suite follows. That matters more than usual because the
 * README tells you to delete `/second`, and a test that named it would turn
 * following the README into a red build.
 *
 * The nav is looked up as `getByRole('navigation', { name: 'Primary' })`, which
 * is the assertion rather than a convenience. The sidebar and the drawer both
 * carry that name, and a lookup that resolves to exactly one element is direct
 * evidence that a screen reader is offered one primary nav and not two.
 */

// The account `auth.spec.ts` registers. Registration is first-user-only in the
// E2E environment, so nothing here creates it: the `account` project in
// playwright.config.ts runs that spec first and this one just logs in.
const EMAIL = 'first@example.com';
const PASSWORD = 'correct-horse-battery';

const DESKTOP = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

// The first destination the shell can navigate away from and back to. `/` is a
// prefix of everything, so `currentHref` special-cases it, which makes any other
// entry the interesting one for both history and deep links.
const elsewhere = navItems.find((item) => item.href !== '/');
// Straight off `navItems`, not off `navSections()`: deriving the expectation
// from the function under test would let a regression that dropped every label
// turn this into a skip instead of a failure.
const groups = [...new Set(navItems.map((item) => item.group).filter((g) => g !== undefined))];

const primaryNav = (page: Page) => page.getByRole('navigation', { name: 'Primary' });
const destination = (page: Page, label: string) =>
  primaryNav(page).getByRole('link', { name: label, exact: true });
const menuButton = (page: Page) => page.getByRole('button', { name: 'Menu' });
// `<dialog>` specifically, not the nav inside it: an empty drawer still holding
// the top layer would be an invisible focus trap over an inert page, and a nav
// that rendered nothing looks identical to one that closed.
const openDialogs = (page: Page) => page.locator('dialog[open]');

/**
 * The requests go through the browser's own `fetch`, from a page already on the
 * origin, rather than through Playwright's `page.request`. That is not a style
 * choice: this suite runs under Bun (see `web/bunfig.toml`), and under Bun
 * `page.request` throws `TypeError: "/api/auth/login" cannot be parsed as a
 * URL` on any response carrying a `Set-Cookie` - which is exactly what a login
 * returns. Cookieless requests are unaffected, which is why `theme.spec.ts` can
 * still fetch the manifest through `page.request`, and the same calls pass
 * under Node, so the failure reads like a bug in this file rather than a
 * runtime mismatch. Going through the page also puts the cookie where it needs
 * to be anyway: `auth.ensure()` reads it back from `GET /api/auth/me` on the
 * next navigation, so no form-filling is needed to get a session.
 */
async function signIn(page: Page) {
  await page.goto('/login');

  const status = await page.evaluate(
    (body) =>
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body
      }).then((res) => res.status),
    JSON.stringify({ email: EMAIL, password: PASSWORD })
  );

  expect(status, 'could not log in as the account auth.spec.ts registers').toBe(200);
}

/** Every destination marked as current except the one that should be. */
async function onlyCurrent(page: Page, href: string) {
  for (const item of navItems) {
    const link = destination(page, item.label);
    if (item.href === href) {
      await expect(link).toHaveAttribute('aria-current', 'page');
    } else {
      await expect(link).not.toHaveAttribute('aria-current', 'page');
    }
  }
}

/**
 * The exposed nav offers `navItems` and nothing else. The count is the half
 * that matters: without it a link hardcoded into `AppShell.svelte` - the exact
 * thing "one entry in one array" is a promise against - would go unnoticed,
 * because every entry it looked for would still be there.
 *
 * This also covers an entry whose route doesn't exist, which is not obvious:
 * SvelteKit renders an unmatched path against the *root* error boundary, so
 * the `(app)` layout - and with it the whole shell - is gone, and every lookup
 * below fails. Measured by pointing an entry at a route that isn't there.
 */
async function offersExactly(page: Page) {
  await expect(primaryNav(page), 'exactly one primary nav should be exposed').toHaveCount(1);
  await expect(primaryNav(page).getByRole('link')).toHaveCount(navItems.length);

  for (const item of navItems) {
    await expect(destination(page, item.label)).toHaveAttribute('href', item.href);
  }
}

test('the shell puts one primary nav on screen, and every destination is reachable in it', async ({
  page
}) => {
  expect(navItems, 'the shell has no destinations, so this test proves nothing').not.toHaveLength(
    0
  );
  await signIn(page);

  await test.step('on desktop the nav is a column down the left', async () => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/');

    const box = await primaryNav(page).boundingBox();
    expect(box, 'the primary nav is not laid out').not.toBeNull();
    expect(box!.x + box!.width, 'the desktop nav should be a column down the left').toBeLessThan(
      DESKTOP.width / 2
    );

    await offersExactly(page);
    await expect(menuButton(page), 'desktop should not offer the drawer').toHaveCount(0);

    for (const item of navItems) {
      await destination(page, item.label).click();
      await expect(page).toHaveURL(item.href);
      await onlyCurrent(page, item.href);
    }
  });

  await test.step('on a phone the same destinations are behind the menu', async () => {
    await page.setViewportSize(PHONE);
    await page.goto('/');

    await expect(primaryNav(page), 'the nav should be closed until asked for').toHaveCount(0);

    for (const item of navItems) {
      // Per destination, not once: navigating closes the drawer, which is the
      // behaviour the assertion at the end of the loop is there to hold onto.
      await menuButton(page).click();
      await offersExactly(page);
      await onlyCurrent(page, new URL(page.url()).pathname);

      await destination(page, item.label).click();
      await expect(page).toHaveURL(item.href);
      await expect(primaryNav(page), 'the drawer should close behind you').toHaveCount(0);
      await expect(openDialogs(page), 'and release the page it was covering').toHaveCount(0);
    }
  });
});

test('a group renders as a heading, not as a destination', async ({ page }) => {
  test.skip(groups.length === 0, 'no nav entry carries a group');

  await signIn(page);
  await page.setViewportSize(DESKTOP);
  await page.goto('/');

  for (const group of groups) {
    await expect(page.getByRole('heading', { name: group, exact: true })).toBeVisible();
    // A section header labels the destinations under it, so it must not look
    // like one of them.
    await expect(page.getByRole('link', { name: group, exact: true })).toHaveCount(0);
  }
});

/**
 * The one piece of nav logic a browser can't demonstrate with the destinations
 * this template ships: `currentHref` is pure, and the case that bites is two
 * entries where one href is a prefix of the other. That is a shape someone
 * reaches by adding two lines to `navItems`, so it's pinned here rather than
 * left to whoever adds them.
 */
test('the marker picks the most specific destination, not every match', () => {
  const items = [
    { href: '/', label: 'Home' },
    { href: '/notes', label: 'Notes' },
    { href: '/notes/archive', label: 'Archive' }
  ];

  expect(currentHref('/', items)).toBe('/');
  expect(currentHref('/notes', items)).toBe('/notes');
  expect(currentHref('/notes/archive', items)).toBe('/notes/archive');
  expect(currentHref('/notes/archive/2024', items)).toBe('/notes/archive');
  expect(currentHref('/notes/123', items)).toBe('/notes');
  expect(currentHref('/elsewhere', items)).toBeUndefined();
});

test('history and deep links keep the marker honest', async ({ page }) => {
  test.skip(
    elsewhere === undefined,
    'the shell has one destination, so there is no second one to navigate to or link at'
  );
  const target = elsewhere!;

  await signIn(page);
  await page.setViewportSize(DESKTOP);

  await test.step('Back returns the marker along with the page', async () => {
    await page.goto('/');
    await destination(page, target.label).click();
    await expect(page).toHaveURL(target.href);

    await page.goBack();
    await expect(page).toHaveURL('/');
    await onlyCurrent(page, '/');
  });

  await test.step('a deep link with a trailing slash lands marked', async () => {
    // The trailing slash is the point: the request reaches the Go binary, which
    // has no file for it and serves index.html, and SvelteKit normalises the
    // pathname before anything renders. `currentHref` leans on that normalisation
    // rather than doing its own, so this is what keeps the lean honest.
    await page.goto(`${target.href}/`);

    await expect(primaryNav(page)).toHaveCount(1);
    await onlyCurrent(page, target.href);
  });
});

test('a failed sign-out stacks under the button rather than beside the theme picker', async ({
  page
}) => {
  // The footer lays its children out in a flex *row*, so this is entirely about
  // how many roots `SignOutButton` renders. When it rendered the button and the
  // alert as siblings, the alert became a third item in that row and squeezed
  // the theme picker into a ~100px sidebar column. Asserting the boxes rather
  // than the markup keeps this about the thing that was actually broken.
  await signIn(page);
  await page.setViewportSize(DESKTOP);
  await page.goto('/');

  await page.route('**/api/auth/logout', (route) => route.fulfill({ status: 500, body: '{}' }));
  await page.getByRole('button', { name: 'Log out' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();

  const picker = await page.getByLabel('Theme').boundingBox();
  const failure = await alert.boundingBox();
  expect(picker).not.toBeNull();
  expect(failure).not.toBeNull();
  expect(failure!.y).toBeGreaterThanOrEqual(picker!.y + picker!.height);
});

test('rotating past the breakpoint with the drawer open leaves one primary nav', async ({
  page
}) => {
  // An iPad crossing 768 -> 1024 in portrait-to-landscape is the one way the
  // sidebar and the drawer can be on screen together, and they share
  // `aria-label="Primary"` - two identically named landmarks, plus a modal
  // sitting on top of a sidebar offering the same links. The drawer closes
  // rather than hiding, so focus and the top layer come back too.
  await signIn(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');

  await menuButton(page).click();
  await expect(openDialogs(page)).toHaveCount(1);

  await page.setViewportSize({ width: 1024, height: 768 });

  await expect(openDialogs(page)).toHaveCount(0);
  await expect(primaryNav(page)).toHaveCount(1);
  await expect(destination(page, navItems[0].label)).toBeVisible();
});
