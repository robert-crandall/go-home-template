import { expect, test, type Page } from '@playwright/test';
import { navItems } from '../src/lib/nav';

/**
 * The navigation shell, against the real binary.
 *
 * Everything here is driven off `navItems`, so this file has no opinion about
 * what the destinations are: delete `/second`, add `/notes`, reorder them - the
 * suite follows. That matters more than usual because the README tells you to
 * delete `/second`, and a test that named it would turn following the README
 * into a red build.
 *
 * The nav is looked up as `getByRole('navigation', { name: 'Primary' })`, which
 * is the assertion rather than a convenience. Both the sidebar and the bottom
 * bar are in the DOM at every width and both carry that name; whichever one is
 * `display: none` is out of the accessibility tree, so a lookup that resolves
 * to exactly one element is direct evidence that a screen reader is offered one
 * primary nav and not two. Which one it resolved to is then measured
 * geometrically - a column down the left, or a strip across the bottom - rather
 * than by sniffing for the classes that put it there.
 */

// The account `auth.spec.ts` registers. Registration is first-user-only in the
// E2E environment, so nothing here creates it: the `account` project in
// playwright.config.ts runs that spec first and this one just logs in.
const EMAIL = 'first@example.com';
const PASSWORD = 'correct-horse-battery';

const DESKTOP = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

// The first destination the shell can navigate away from and back to. `/` is a
// prefix of everything, so `isCurrent` special-cases it, which makes any other
// entry the interesting one for both history and deep links.
const elsewhere = navItems.find((item) => item.href !== '/');

const primaryNav = (page: Page) => page.getByRole('navigation', { name: 'Primary' });
const destination = (page: Page, label: string) =>
  primaryNav(page).getByRole('link', { name: label, exact: true });

/**
 * The requests go through the browser's own `fetch`, from a page already on the
 * origin, rather than through Playwright's `page.request`. That is not a style
 * choice: this suite runs under Bun (see `web/bunfig.toml`), and under Bun
 * `page.request` throws `TypeError: "/api/auth/login" cannot be parsed as a
 * URL` on any response carrying a `Set-Cookie` - which is every response worth
 * making here. Cookieless responses are fine, and the same calls pass under
 * Node, so the failure reads like a bug in this file rather than a runtime
 * mismatch. Going through the page also puts the cookie where it needs to be
 * anyway: `auth.ensure()` reads it back from `GET /api/auth/me` on the next
 * navigation, so no form-filling is needed to get a session.
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
 * Click through every destination in whichever nav is showing, and check the
 * marker lands on it and nowhere else. This is what makes "adding a destination
 * is one line" true rather than aspirational - a new entry in `navItems` is
 * clicked here the moment it exists, at both widths.
 */
async function visitEveryDestination(page: Page) {
  await expect(primaryNav(page), 'exactly one primary nav should be exposed').toHaveCount(1);

  for (const item of navItems) {
    await destination(page, item.label).click();
    await expect(page).toHaveURL(item.href);
    await onlyCurrent(page, item.href);
  }
}

test('the shell puts one primary nav on screen, and every destination is reachable in it', async ({
  page
}) => {
  await signIn(page);

  await test.step('on desktop the nav is a column down the left', async () => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/');

    const box = await primaryNav(page).boundingBox();
    expect(box, 'the primary nav is not laid out').not.toBeNull();
    expect(box!.x + box!.width, 'the desktop nav should be a column down the left').toBeLessThan(
      DESKTOP.width / 2
    );

    await visitEveryDestination(page);
  });

  await test.step('on a phone it is a bar across the bottom, with the same destinations', async () => {
    await page.setViewportSize(PHONE);
    await page.goto('/');

    const box = await primaryNav(page).boundingBox();
    expect(box, 'the primary nav is not laid out').not.toBeNull();
    expect(box!.width, 'the phone nav should span the width').toBeGreaterThanOrEqual(
      PHONE.width - 1
    );
    expect(box!.y + box!.height, 'the phone nav should sit at the bottom').toBeGreaterThan(
      PHONE.height - 2
    );

    await visitEveryDestination(page);
  });
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
    // pathname before anything renders. `isCurrent` leans on that normalisation
    // rather than doing its own, so this is what keeps the lean honest.
    await page.goto(`${target.href}/`);

    await expect(primaryNav(page)).toHaveCount(1);
    await onlyCurrent(page, target.href);
  });
});
