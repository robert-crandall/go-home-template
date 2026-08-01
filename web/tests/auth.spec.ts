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

const RENDER_FLAG = '__greetingEverRendered';

/**
 * Records whether the guarded page's greeting was ever in the document, at any
 * instant, rather than whether it is there now.
 *
 * `addInitScript` runs on every navigation before any app code, so the app
 * cannot mount ahead of the observer. The check reads the mutation records'
 * `addedNodes` instead of re-querying the document, because records are
 * delivered in a microtask: a node inserted and removed again before delivery
 * is absent from a query but still present in the log. The flag lives in
 * `sessionStorage` rather than on `window` so that it survives the redirect
 * itself: a guard that flashed the page and then hard-navigated would wipe a
 * `window` flag along with the document, hiding the very flash we're measuring.
 *
 * The claim this earns is narrow but sufficient: it catches the Svelte mount of
 * the guarded page, which is the flash the criterion is about. It is not a
 * general "nothing ever rendered" detector - content injected before the
 * document exists, or drawn without an `h1`, would not trip it.
 */
async function watchForGreetingRender(page: Page) {
  await page.addInitScript((flag) => {
    const isGreeting = (el: Element) =>
      el.tagName === 'H1' && el.textContent?.trim() === 'Hello';

    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          // Svelte inserts a built subtree, so the greeting usually arrives as
          // a descendant of the added node rather than as the node itself.
          if (isGreeting(node) || [...node.querySelectorAll('h1')].some(isGreeting)) {
            sessionStorage.setItem(flag, 'true');
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  }, RENDER_FLAG);
}

const greetingEverRendered = (page: Page) =>
  page.evaluate((flag) => sessionStorage.getItem(flag) === 'true', RENDER_FLAG);

async function chooseMode(page: Page, tab: 'Log in' | 'Register') {
  const toggle = modeToggle(page).getByRole('button', { name: tab, exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Fills and submits whatever form is on screen. Deliberately separate from
 * `chooseMode`: once an account exists the toggle isn't rendered at all, so a
 * helper that always reached for it could only ever drive the open case.
 */
async function submitCredentials(
  page: Page,
  submit: 'Log in' | 'Create account',
  email: string,
  password: string
) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await credentialsForm(page).getByRole('button', { name: submit }).click();
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

  await watchForGreetingRender(page);

  await test.step('the guarded page bounces a signed-out visitor to /login', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(greeting(page)).toHaveCount(0);

    // toHaveCount(0) only samples the DOM once the redirect has settled, so on
    // its own it would pass a guard that painted the page for a frame and then
    // bounced - and "no flash" is the actual criterion. Measured, not assumed:
    // moving the guard into the component makes the check below fail while the
    // one above still passes. The observer is what closes that gap.
    expect(await greetingEverRendered(page), 'the guarded page rendered before redirecting').toBe(
      false
    );

    // No Google client is configured for this server, so /api/auth/google/start
    // isn't mounted and the button must not be there - it would navigate the
    // browser to the JSON 404 the server gives every unknown /api path. The
    // signed-in half can't be tested here: there is no way to complete a real
    // Google consent screen from a test.
    await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveCount(0);
  });

  await test.step('registering the first account signs you in', async () => {
    // Registration is open - there is no account yet - so the page opens on the
    // register form rather than making you find it.
    await expect(
      modeToggle(page).getByRole('button', { name: 'Register', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');

    // The pair still works both ways, which is what an app running with
    // ALLOW_OPEN_REGISTRATION=true depends on: for it, open is permanent and
    // log in has to stay reachable.
    await chooseMode(page, 'Log in');
    await expect(credentialsForm(page).getByRole('button', { name: 'Log in' })).toBeVisible();
    await chooseMode(page, 'Register');

    await submitCredentials(page, 'Create account', EMAIL, PASSWORD);
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

    // Both assertions above render from `data.user`, which the refused logout
    // never touched - so they'd pass even if the click had wrongly cleared the
    // in-memory session. Back is the path that makes that state observable
    // today: `/login` is behind us in history, and its guard reads `auth.user`,
    // not `data`, so a still-signed-in visitor gets bounced back to the
    // greeting instead of being handed the login form.
    //
    // The URL is asserted alongside the content because a `load` that redirects
    // during a popstate used to leave the address bar on the entry you went to
    // (#18) - the greeting rendered under `/login`. The root layout now puts the
    // bar back; drop the layout's `afterNavigate` and this line is what fails.
    const bounced = page.waitForEvent('framenavigated');
    await page.goBack();
    await bounced;
    await expect(greeting(page)).toBeVisible();
    await expect(credentialsForm(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);

    // Back to a clean history entry, so the real logout below is testing the
    // app rather than the state this probe left behind.
    await page.goForward();
    await expect(page).toHaveURL(/\/$/);
    await expect(greeting(page)).toBeVisible();
  });

  await test.step('logging out returns you to /login and sticks', async () => {
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    await expect(greeting(page)).toHaveCount(0);
  });

  await test.step('Back off the login page stays on the login page', async () => {
    // The other direction of #18, and the one the issue measured as landing on
    // `/`: signed out, with `/` still behind us in history, Back runs the
    // guard on `/`, which bounces to `/login`. Content and URL both have to end
    // up there. Without the fix the login form renders under `/`.
    const bounced = page.waitForEvent('framenavigated');
    await page.goBack();
    await bounced;
    await expect(credentialsForm(page)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  await test.step('a wrong password shows the server error inline', async () => {
    // A real email and a password long enough to clear both the browser's
    // minlength and huma's 422, so the 401 is what actually comes back.
    await submitCredentials(page, 'Log in', EMAIL, 'wrong-but-long-enough');
    await expect(alert(page)).toHaveText('invalid email or password');
    await expect(page).toHaveURL(/\/login$/);
  });

  await test.step('with an account on file, /login offers no way to register', async () => {
    // The point of the change: the gate is closed for the rest of this app's
    // life, so the control that could only ever produce "registration is
    // closed" is not on the page at all.
    await expect(modeToggle(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create account' })).toHaveCount(0);
  });

  await test.step('a registration the server refuses still says so', async () => {
    // The state is advisory - under the default gate the register handler
    // re-checks under a lock - so the page can be holding a
    // `registrationOpen: true` that stopped being true, and has to render the
    // refusal rather than assume it can't happen. Stubbing the state is the
    // only way to reach that here, since the real gate has been closed since
    // the first account.
    //
    // The stub goes in before the navigation, because `load` runs once.
    await page.route('**/api/app', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ registrationOpen: true })
      })
    );
    await page.reload();

    await chooseMode(page, 'Register');
    await submitCredentials(page, 'Create account', 'second@example.com', PASSWORD);
    await expect(alert(page)).toHaveText('registration is closed');
    await expect(page).toHaveURL(/\/login$/);

    // Back to the real state, so the last step tests the app rather than the
    // stub.
    await page.unroute('**/api/app');
    await page.reload();
    await expect(modeToggle(page)).toHaveCount(0);
  });

  await test.step('logging back in works', async () => {
    await submitCredentials(page, 'Log in', EMAIL, PASSWORD);
    await expect(page).toHaveURL(/\/$/);
    await expect(greeting(page)).toBeVisible();
  });

  expect(authHeaders, 'the session cookie should be the only credential').toEqual([]);
});
