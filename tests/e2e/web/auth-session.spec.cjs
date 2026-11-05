const fs = require('node:fs');
const path = require('node:path');
const { test, expect, accounts, login, clients } = require('../helpers/auth.cjs');
const {
  observeRuntime,
  snapshot,
  rememberQueries,
  queriesPreserved,
} = require('../helpers/auth-runtime.cjs');
const local = require('../../../scripts/e2e/local.cjs');

test.beforeEach(() => local.softReset(accounts()));
test.afterEach(() => local.softReset(accounts()));

async function start(page) {
  const { a, b } = accounts();
  await observeRuntime(page);
  await page.goto('/login');
  await page.waitForFunction(() => globalThis.__bf305Runtime?.client);
  await page.evaluate(() => globalThis.__bf305Runtime.client.auth.stopAutoRefresh());
  await login(page, a, false);
  await clients(page, a, b);
  return { a, b };
}

async function invalidate(page, a) {
  await page.evaluate(() => globalThis.__bf305Runtime.client.auth.stopAutoRefresh());
  const before = await snapshot(page, a);
  local.softReset({ a });
  await page.waitForFunction((expiry) => Date.now() >= expiry * 1000 + 250, before.expiresAt, {
    timeout: 25000,
  });
  const refresh = await page.evaluate(async () => {
    const { data, error } = await globalThis.__bf305Runtime.client.auth.refreshSession();
    return { rejected: error !== null, hasSession: data.session !== null, code: error?.code };
  });
  expect(refresh).toMatchObject({ rejected: true, hasSession: false });
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
  expect((await snapshot(page, a)).privateQueryCount).toBe(0);
  return refresh;
}

test('BF305-10 actual expiry and revoked refresh clear private runtime state', async ({ page }) => {
  const { a, b } = accounts();
  await observeRuntime(page);
  await page.goto('/login');
  await page.waitForFunction(() => globalThis.__bf305Runtime?.client);
  await page.evaluate(() => globalThis.__bf305Runtime.client.auth.stopAutoRefresh());
  await login(page, a, false);
  await clients(page, a, b);
  const before = await snapshot(page, a);
  expect(before.sameUser).toBe(true);
  expect(before.privateQueryCount).toBeGreaterThan(0);
  expect(before.expiresAt * 1000 - Date.now()).toBeLessThanOrEqual(21000);
  local.softReset({ a });
  // Await actual server-issued JWT expiry. Do not alter client clocks or persisted tokens.
  await page.waitForFunction((expiry) => Date.now() >= expiry * 1000 + 250, before.expiresAt, {
    timeout: 25000,
  });
  const refresh = await page.evaluate(async () => {
    const { data, error } = await globalThis.__bf305Runtime.client.auth.refreshSession();
    return { rejected: error !== null, hasSession: data.session !== null, code: error?.code };
  });
  expect(refresh.rejected).toBe(true);
  expect(refresh.hasSession).toBe(false);
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
  await expect(page.getByText(a.clientName, { exact: true })).toHaveCount(0);
  const after = await snapshot(page, a);
  fs.writeFileSync(
    path.join(process.env.E2E_RUN_DIRECTORY, 'auth-expiry-observation.json'),
    JSON.stringify({ before, after, refresh }, null, 2),
  );
  expect(after.persistedSession).toBe(false);
  expect(after.signedOutEvents).toBeGreaterThan(0);
  expect(after.privateQueryCount).toBe(0);
});

test('BF305-11 real same-user refresh preserves tenant and exact private cache', async ({
  page,
}) => {
  const { a, b } = await start(page);
  expect(await rememberQueries(page)).toBeGreaterThan(0);
  const before = await snapshot(page, a);
  const refresh = await page.evaluate(async () => {
    const { data, error } = await globalThis.__bf305Runtime.client.auth.refreshSession();
    return { success: !error && !!data.session };
  });
  expect(refresh.success).toBe(true);
  expect(await queriesPreserved(page)).toBe(true);
  const after = await snapshot(page, a);
  expect(after.sameUser).toBe(true);
  expect(after.signedOutEvents).toBe(before.signedOutEvents);
  await expect(page.getByText(a.clientName, { exact: true })).toBeVisible();
  await expect(page.getByText(b.clientName, { exact: true })).toHaveCount(0);
});

test('BF305-12 rejected automatic refresh is bounded and blocks protected navigation', async ({
  page,
}) => {
  const { a } = await start(page);
  let attempts = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token')
      attempts++;
  });
  const before = await snapshot(page, a);
  local.softReset({ a });
  await page.waitForFunction((expiry) => Date.now() >= expiry * 1000 + 250, before.expiresAt, {
    timeout: 25000,
  });
  await page.evaluate(() => globalThis.__bf305Runtime.client.auth.startAutoRefresh());
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
  const after = await snapshot(page, a);
  expect(after.persistedSession).toBe(false);
  expect(after.privateQueryCount).toBe(0);
  expect(attempts).toBe(1);
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await globalThis.__bf305Runtime.client.auth.getSession();
  });
  expect(attempts).toBe(1);
  await page.goto('/clients');
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
  await expect(page.getByText(a.clientName, { exact: true })).toHaveCount(0);
});

test('BF305-13 controlled real-SDK recovery event removes tenant and private cache', async ({
  page,
}) => {
  const { a } = await start(page);
  // Guard boundary only, not email/PKCE delivery: use the genuine current session inside SDK.
  await page.evaluate(async () => {
    const auth = globalThis.__bf305Runtime.client.auth;
    const {
      data: { session },
    } = await auth.getSession();
    if (!session) throw new Error('Recovery guard fixture requires real session');
    await auth._notifyAllSubscribers('PASSWORD_RECOVERY', session);
  });
  await expect(page.getByRole('button', { name: 'Guardar contraseña', exact: true })).toBeVisible();
  expect((await snapshot(page, a)).privateQueryCount).toBe(0);
  await expect(page.getByText(a.clientName, { exact: true })).toHaveCount(0);
  await page.goto('/clients');
  await expect(page.getByRole('button', { name: 'Guardar contraseña', exact: true })).toBeVisible();
  expect((await snapshot(page, a)).privateQueryCount).toBe(0);
});

test('BF305-14 invalidated A then real B login cannot observe A', async ({ page }) => {
  const { a, b } = await start(page);
  await invalidate(page, a);
  await login(page, b, false);
  await clients(page, b, a);
  expect((await snapshot(page, a)).privateQueryCount).toBe(0);
  expect((await snapshot(page, b)).sameUser).toBe(true);
});

test('BF305-15 late real A response after invalidation cannot restore A in B', async ({ page }) => {
  const { a, b } = await start(page);
  let signal, release, delivered;
  const received = new Promise((resolve) => {
    signal = resolve;
  });
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const delivery = new Promise((resolve) => {
    delivered = resolve;
  });
  await page.route('**/rest/v1/clients?*', async (route) => {
    if (!route.request().url().includes(a.businessId)) return route.continue();
    try {
      const response = await route.fetch();
      signal();
      await barrier;
      await route.fulfill({ response });
    } finally {
      delivered();
    }
  });
  try {
    await page.getByLabel('Buscar clientes', { exact: true }).fill('BF');
    await received;
    await invalidate(page, a);
    await login(page, b, false);
    await clients(page, b, a);
    release();
    await delivery;
    await expect(page.getByText(b.clientName, { exact: true })).toBeVisible();
    await expect(page.getByText(a.clientName, { exact: true })).toHaveCount(0);
    expect((await snapshot(page, a)).privateQueryCount).toBe(0);
  } finally {
    release();
  }
});
