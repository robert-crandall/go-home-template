import { expect, test, type Page } from '@playwright/test';
import { navItems } from '../src/lib/nav';

/**
 * The navigation shell, against the real binary.
 *
 * One sequential test, like the rest of the suite: the desktop steps, the phone
 * steps, and the deep link all run in one browser context because they all need
 * the same session, and Playwright gives every `test` a fresh one.
 *
 * The nav is looked up as `getByRole('navigation', { name: 'Primary' })`, which
 * is the whole point of the assertion rather than a convenience. Both the
 * sidebar and the bottom bar are in the DOM at every width and both carry that
 * name; whichever one is `display: none` is out of the accessibility tree, so a
 * lookup that resolves to exactly one element is direct evidence that a screen
 * reader is offered one primary nav and not two. Which one it resolved to is
 * then measured geometrically - a column down the left, or a strip across the
 * bottom - rather than by sniffing for the classes that put it there.
 *
 * The destination list comes from `$lib/nav`, so adding an entry there extends
 * this test rather than leaving it behind.
 */

// The same account `auth.spec.ts` registers. Registration is first-user-only in
// the E2E environment, so exactly one of the two files creates it and the other
// logs in - see `signIn` below, which handles both without caring which ran.
const EMAIL = 'first@example.com';
const PASSWORD = 'correct-horse-battery';

const primaryNav = (page: Page) => page.getByRole('navigation', { name: 'Primary' });
const destination = (page: Page, label: string) =>
  primaryNav(page).getByRole('link', { name: label, exact: true });

/**
 * A session, without depending on which spec file ran first.
 *
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
 *
 * The fallback branches on a specific status rather than on "not ok": a 401 is
 * the server saying there is no such account yet, which is the one case
 * registration fixes. Anything else is a broken server, and failing here says
 * so instead of leaving a confusing "still on /login" three steps later.
 */
async function signIn(page: Page) {
  await page.goto('/login');

  const post = (path: string) =>
    page.evaluate(
      ({ path, body }) =>
        fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body
        }).then((res) => res.status),
      { path, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) }
    );

  const login = await post('/api/auth/login');
  if (login === 200) return;

  expect(login, 'login failed for a reason other than "no such account yet"').toBe(401);
  expect(await post('/api/auth/register'), 'registering the test account failed').toBe(200);
}

async function navBox(page: Page) {
  const box = await primaryNav(page).boundingBox();
  expect(box, 'the primary nav has no box, so it is not laid out').not.toBeNull();
  return box!;
}

test('the shell navigates at both widths, and a deep link lands with the right destination marked', async ({
  page
}) => {
  await signIn(page);

  const desktop = page.viewportSize()!;
  const phone = { width: 390, height: 844 };

  await test.step('on desktop the visible chrome is a sidebar, with every destination in it', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Hello' })).toBeVisible();

    await expect(primaryNav(page), 'exactly one primary nav should be exposed').toHaveCount(1);

    const box = await navBox(page);
    expect(box.x + box.width, 'the desktop nav should be a column down the left').toBeLessThan(
      desktop.width / 2
    );

    for (const item of navItems) {
      await expect(destination(page, item.label)).toBeVisible();
    }
  });

  await test.step('the current destination is marked, and clicking another moves the mark', async () => {
    await expect(destination(page, 'Home')).toHaveAttribute('aria-current', 'page');
    await expect(destination(page, 'Second page')).not.toHaveAttribute('aria-current', 'page');

    await destination(page, 'Second page').click();
    await expect(page).toHaveURL(/\/second$/);
    await expect(page.getByRole('heading', { name: 'Second page' })).toBeVisible();
    await expect(destination(page, 'Second page')).toHaveAttribute('aria-current', 'page');
    await expect(destination(page, 'Home')).not.toHaveAttribute('aria-current', 'page');
  });

  await test.step('Back returns the mark along with the page', async () => {
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Hello' })).toBeVisible();
    await expect(destination(page, 'Home')).toHaveAttribute('aria-current', 'page');
  });

  await test.step('on a phone the chrome is a bottom bar, and nothing is desktop-only', async () => {
    await page.setViewportSize(phone);

    await expect(primaryNav(page), 'exactly one primary nav should be exposed').toHaveCount(1);

    const box = await navBox(page);
    expect(box.width, 'the phone nav should span the width').toBeGreaterThanOrEqual(
      phone.width - 1
    );
    expect(box.y + box.height, 'the phone nav should sit at the bottom').toBeGreaterThan(
      phone.height - 2
    );

    for (const item of navItems) {
      await expect(destination(page, item.label)).toBeVisible();
    }
    await expect(destination(page, 'Home')).toHaveAttribute('aria-current', 'page');
  });

  await test.step('tapping a destination in the bottom bar navigates', async () => {
    await destination(page, 'Second page').click();
    await expect(page).toHaveURL(/\/second$/);
    await expect(page.getByRole('heading', { name: 'Second page' })).toBeVisible();
    await expect(destination(page, 'Second page')).toHaveAttribute('aria-current', 'page');
  });

  await test.step('a deep link with a trailing slash loads its page, marked', async () => {
    // The trailing slash is the point: this request reaches the Go binary,
    // which has no file for it and serves index.html, and SvelteKit normalises
    // the pathname to `/second` before anything renders. `isCurrent` leans on
    // that normalisation rather than doing its own, so this is what keeps the
    // lean honest.
    await page.setViewportSize(desktop);
    await page.goto('/second/');

    await expect(page.getByRole('heading', { name: 'Second page' })).toBeVisible();
    await expect(destination(page, 'Second page')).toHaveAttribute('aria-current', 'page');
    await expect(destination(page, 'Home')).not.toHaveAttribute('aria-current', 'page');
  });
});
