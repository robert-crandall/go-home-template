import { defineConfig, devices } from '@playwright/test';

// 8081, not 8080, so a `make dev` you forgot about doesn't collide with the
// suite - or worse, silently serve it.
const PORT = 8081;
// The slug, so `make init` renames this along with everything else and a
// renamed template doesn't quietly share a database with the one it came from.
const DB = process.env.E2E_DATABASE_NAME ?? 'go-home-template_e2e';

export default defineConfig({
  testDir: 'tests',
  // The suite drives one login session through one browser context. Running it
  // in parallel against a shared database would have workers registering the
  // first user out from under each other.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Relative to this config's directory (web/), which is why the script cds
    // to the repo root before doing anything.
    command: `../scripts/e2e-server.sh ${PORT} ${DB}`,
    // /healthz pings Postgres, so this waits for a server that can actually
    // serve the suite rather than one that has merely bound the port.
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 60_000
  }
});
