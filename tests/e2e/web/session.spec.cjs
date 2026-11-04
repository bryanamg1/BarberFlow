const { test, expect, accounts, login, logout, settings, clients } = require('../helpers/auth.cjs');

test('BF305-01 OWNER A real login and tenant A', async ({ page }) => {
  const { a, b } = accounts();
  await login(page, a);
  await clients(page, a, b);
});

test('BF305-02 invalid credentials preserve public login', async ({ page }) => {
  const { a } = accounts();
  await page.goto('/login');
  await page.getByLabel('Correo electrónico', { exact: true }).fill(a.email);
  await page.getByLabel('Contraseña', { exact: true }).fill('incorrect-synthetic-credential');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await expect(
    page.getByText('El correo o la contraseña son incorrectos.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true })).toHaveCount(0);
});

test('BF305-03 reload preserves real session and identity', async ({ page }) => {
  const { a, b } = accounts();
  await login(page, a);
  await clients(page, a, b);
  await page.reload();
  await expect(page.getByText(a.clientName, { exact: true })).toBeVisible();
  await expect(page.getByText(b.clientName, { exact: true })).toHaveCount(0);
});

test('BF305-04 logout and Back cannot restore private content', async ({ page }) => {
  const { a, b } = accounts();
  await login(page, a);
  await clients(page, a, b);
  await logout(page);
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
  await expect(page.getByText(a.clientName, { exact: true })).toHaveCount(0);
});

test('BF305-05 direct protected route without session stays public', async ({ page }) => {
  await page.goto('/clients');
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear cliente', exact: true })).toHaveCount(0);
});

test('BF305-06 OWNER B real login and tenant B', async ({ page }) => {
  const { a, b } = accounts();
  await login(page, b);
  await clients(page, b, a);
});

test('BF305-07 same runtime switches A to B without tenant leakage', async ({ page }) => {
  const { a, b } = accounts();
  await login(page, a);
  await clients(page, a, b);
  await logout(page);
  await login(page, b, false);
  await clients(page, b, a);
});

test('BF305-08 late real A response cannot repopulate B', async ({ page }) => {
  const { a, b } = accounts();
  await login(page, a);
  let signal;
  const received = new Promise((resolve) => {
    signal = resolve;
  });
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  let delivered;
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
    await page.getByRole('tab', { name: 'Clientes', exact: true }).click();
    await received;
    await logout(page);
    await login(page, b, false);
    await clients(page, b, a);
    release();
    await delivery;
    await expect(page.getByText(b.clientName, { exact: true })).toBeVisible();
    await expect(page.getByText(a.clientName, { exact: true })).toHaveCount(0);
    // Revisit the same resource through real navigation after the old request settles.
    await settings(page);
    await page.goBack();
    await expect(page.getByText(b.clientName, { exact: true })).toBeVisible();
    await expect(page.getByText(a.clientName, { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
});

test('BF305-09 failed business bootstrap shows safe error without tenant fallback', async ({
  page,
}) => {
  await page.route('**/rest/v1/business_members?*', (route) => route.abort('failed'));
  await login(page, accounts().a);
  await expect(
    page.getByText('No se pudo conectar con el servicio. Inténtalo nuevamente.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear cliente', exact: true })).toHaveCount(0);
  await expect(page.getByText(accounts().b.clientName, { exact: true })).toHaveCount(0);
});
