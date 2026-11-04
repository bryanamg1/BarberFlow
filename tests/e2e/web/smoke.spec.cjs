const { test, expect, accounts, login, logout } = require('../helpers/auth.cjs');

test('BF305-00 real UI login and logout smoke', async ({ page }) => {
  await login(page, accounts().a);
  await logout(page);
  await expect(page.getByLabel('Correo electrónico', { exact: true })).toBeVisible();
});
