const { test: base, expect } = require('@playwright/test');
const { accountGuard, guard, manifest } = require('./environment.cjs');
const path = require('node:path');
const { redactTestError } = require('./diagnostics.cjs');

const test = base.extend({
  page: async ({ page }, runWithPage, testInfo) => {
    guard();
    if (!process.env.E2E_RUN_ID || !process.env.E2E_ACCOUNTS)
      throw new Error('Use the E2E coordinator');
    // A separate context is provided by Playwright for every test. Never serialize storageState.
    await page.context().route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if ([manifest.baseUrl, manifest.supabaseUrl].includes(url.origin)) await route.continue();
      else await route.abort('blockedbyclient');
    });
    try {
      await runWithPage(page);
    } finally {
      const secrets = [
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
        ...Object.values(accounts()).map((user) => user.password),
      ];
      for (const error of testInfo.errors) redactTestError(error, secrets);
      if (testInfo.status !== testInfo.expectedStatus && page.url().startsWith(manifest.baseUrl)) {
        // Mask ALL inputs, including password reveal states; exclude callback/recovery screens.
        const url = new URL(page.url());
        if (!url.search && !url.hash && !url.pathname.includes('recovery')) {
          await page
            .screenshot({
              path: path.join(
                process.env.E2E_RUN_DIRECTORY,
                `${testInfo.title.match(/^BF305-\d+/)?.[0].toLowerCase()}-failure.png`,
              ),
              mask: [page.locator('input, textarea')],
            })
            .catch(() => {});
        }
      }
    }
  },
});

function accounts() {
  const users = JSON.parse(process.env.E2E_ACCOUNTS);
  for (const user of Object.values(users)) accountGuard(user.email);
  return users;
}

async function login(page, user, navigate = true) {
  if (navigate) await page.goto('/login');
  await page.getByLabel('Correo electrónico', { exact: true }).fill(user.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toHaveCount(0);
  // Expo Router renders a heading in the route header and another in the screen body.
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true }).first()).toBeVisible();
}

async function settings(page) {
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
}

async function logout(page) {
  await settings(page);
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
}

async function clients(page, user, foreign) {
  await page.getByRole('tab', { name: 'Clientes', exact: true }).click();
  await expect(page.getByText(user.clientName, { exact: true })).toBeVisible();
  await expect(page.getByText(foreign.clientName, { exact: true })).toHaveCount(0);
}

module.exports = { test, expect, accounts, login, logout, settings, clients };
