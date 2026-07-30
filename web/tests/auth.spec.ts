import { expect, test, type Page } from '@playwright/test';

/**
 * The whole auth journey as ONE test, not a describe.serial of several.
 *
 * Playwright gives every test a fresh browser context - so a split suite would
 * start each step logged out, and "reload and stay logged in" would be checking
 * nothing. One test means one context, one cookie jar, and a flow that is
 * actually a flow.
 *
 * The order matters too: the auth-form negative cases have to happen while
 * logged out, because a signed-in visitor gets bounced off /login. The
 * logout-refusal case is the exception - it only makes sense signed in.
 */

const EMAIL = 'first@example.com';
const PASSWORD = 'correct-horse-battery';

const greeting = (page: Page) => page.getByRole('heading', { name: 'Hello' });
const alert = (page: Page) => page.getByRole('alert');

// In login mode the toggle and the submit button are both named "Log in",
// so both lookups are scoped rather than reaching for .first().
const modeToggle = (page: Page) => page.getByRole('group', { name: 'Log in or register' });
const credentialsForm = (page: Page) => page.locator('form');

async function submitCredentials(page: Page, tab: 'Log in' | 'Register', password: string) {
  const toggle = modeToggle(page).getByRole('button', { name: tab, exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(password);
  await credentialsForm(page)
    .getByRole('button', { name: tab === 'Log in' ? 'Log in' : 'Create account' })
    .click();
}

test('register, stay signed in across reloads, log out, and log back in', async ({ page }) => {
  // Attached before the first navigation so nothing escapes it. The session is
  // an HttpOnly cookie and the client sets no headers, so a stray
  // Authorization header would mean someone reinvented token auth by hand.
  const authHeaders: string[] = [];
  page.on('request', (request) => {
    const header = request.headers()['authorization'];
    if (header) authHeaders.push(`${request.method()} ${request.url()}`);
  });

  await test.step('the guarded page bounces a signed-out visitor to /login', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    // The guard lives in `load`, so SvelteKit should never have rendered the
    // page component. This checks the destination, not the absence of a flash -
    // proving *that* would need render instrumentation the guard doesn't earn.
    await expect(greeting(page)).toHaveCount(0);
  });

  await test.step('registering the first account signs you in', async () => {
    await submitCredentials(page, 'Register', PASSWORD);
    await expect(page).toHaveURL(/\/$/);
    await expect(greeting(page)).toBeVisible();
    await expect(page.getByText(EMAIL)).toBeVisible();
  });

  await test.step('the session survives a reload', async () => {
    await page.reload();
    await expect(greeting(page)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  await test.step('a logout the server refused does not pretend to succeed', async () => {
    // The only faked responses in this suite, because a healthy server cannot
    // produce them. /api/auth/logout 500s only when it could not revoke the
    // session, and it deliberately leaves the cookie alive when that happens -
    // so clearing local state anyway would look like a logout and not be one.
    await page.route('**/api/auth/logout', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          status: 500,
          title: 'Internal Server Error',
          detail: 'could not revoke session'
        })
      })
    );
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(alert(page)).toHaveText('could not revoke session');
    await expect(page).toHaveURL(/\/$/);
    await expect(greeting(page)).toBeVisible();

    // And the other half: openapi-fetch lets a fetch-level rejection through
    // rather than returning it, so a server that vanished mid-click has to
    // leave a usable button behind instead of one disabled forever.
    await page.unroute('**/api/auth/logout');
    await page.route('**/api/auth/logout', (route) => route.abort('connectionrefused'));
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(alert(page)).toHaveText('Could not reach the server.');
    await expect(page.getByRole('button', { name: 'Log out' })).toBeEnabled();
    await page.unroute('**/api/auth/logout');
  });

  await test.step('logging out returns you to /login and sticks', async () => {
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    await expect(greeting(page)).toHaveCount(0);
  });

  await test.step('a wrong password shows the server error inline', async () => {
    // A real email and a password long enough to clear both the browser's
    // minlength and huma's 422, so the 401 is what actually comes back.
    await submitCredentials(page, 'Log in', 'wrong-but-long-enough');
    await expect(alert(page)).toHaveText('invalid email or password');
    await expect(page).toHaveURL(/\/login$/);
  });

  await test.step('a second registration is refused, in the server’s words', async () => {
    await modeToggle(page).getByRole('button', { name: 'Register', exact: true }).click();
    await page.getByLabel('Email').fill('second@example.com');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(alert(page)).toHaveText('registration is closed');
    await expect(page).toHaveURL(/\/login$/);
  });

  await test.step('logging back in works', async () => {
    await submitCredentials(page, 'Log in', PASSWORD);
    await expect(page).toHaveURL(/\/$/);
    await expect(greeting(page)).toBeVisible();
  });

  expect(authHeaders, 'the session cookie should be the only credential').toEqual([]);
});
