const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  test: base,
  expect,
  accounts,
  login,
  restrictToLocal,
  caller,
} = require('../helpers/auth.cjs');
const { manifest } = require('../helpers/environment.cjs');
const checkout = require('../../../scripts/e2e/checkout.cjs');
const local = require('../../../scripts/e2e/local.cjs');

let caseIndex = 0;
const test = base.extend({
  checkoutBaseline: [
    async ({ browserName }, runWithBaseline) => {
      assert.equal(browserName, 'chromium');
      // Reset is environment setup, not part of the UI interaction deadline. Keep
      // both clocks bounded at 60 seconds; do not inflate the actual test timeout.
      if (caseIndex++ > 0) checkout.reset(accounts());
      await runWithBaseline();
    },
    { auto: true, timeout: 60000 },
  ],
});
test.afterEach(async ({ page }) => {
  // Context closure is handled by Playwright. Revoke all synthetic server sessions as well.
  await page.goto('/login').catch(() => {});
  local.softReset(accounts());
});

const service = { type: 'SERVICE', quantity: 1, price: '15.01' };
const product = { type: 'PRODUCT', quantity: 1, price: '10.02' };
const button = (page, name) => page.getByRole('button', { name, exact: true });
const money = (label, value) => `${label}: ARS ${value.replace('.', ',')}`;

async function open(page) {
  await button(page, 'Acciones rápidas').click();
  await button(page, 'Nueva venta').click();
  await expect(page).toHaveURL(/\/sales\/new$/);
  await expect(page.getByText('Sin servicios seleccionados', { exact: true })).toBeVisible();
  await expect(page.getByText('Cliente: Sin cliente', { exact: true })).toBeVisible();
  await expect(button(page, 'Completar venta')).toBeDisabled();
}
async function add(page, type) {
  const f = checkout.fixture();
  await button(
    page,
    `Agregar ${type === 'SERVICE' ? 'servicio' : 'producto'}: ${type === 'SERVICE' ? f.serviceName : f.productName}`,
  ).click();
}
async function pay(page, method = 'Efectivo') {
  await button(page, `Método de pago: ${method}`).click();
  await expect(button(page, 'Completar venta')).toBeEnabled();
}
async function submit(page) {
  await button(page, 'Completar venta').click();
  await expect(page).toHaveURL(/\/sales\/[a-f0-9-]{36}$/);
  await expect(
    page.getByRole('heading', { name: 'Detalle de venta', exact: true }).first(),
  ).toBeVisible();
}
function evidence(name, expected, snapshot) {
  // No Auth payload, HTTP headers, credentials, URLs with query params or session objects.
  fs.writeFileSync(
    path.join(process.env.E2E_RUN_DIRECTORY, `${name}-persistence.json`),
    JSON.stringify(
      {
        result: 'PASS',
        expected,
        saleId: snapshot.sales[0]?.id,
        counts: {
          sales: snapshot.sales.length,
          items: snapshot.items.length,
          payments: snapshot.payments.length,
        },
        stock: checkout.stock(),
        appointmentStatus: snapshot.appointment.status,
      },
      null,
      2,
    ) + '\n',
  );
}
async function detail(page, expected) {
  const actual = checkout.snapshot();
  const id = checkout.verify(actual, expected);
  await expect(page).toHaveURL(`${manifest.baseUrl}/sales/${id}`);
  await expect(page.getByText(`Venta: ${id}`, { exact: true })).toBeVisible();
  await expect(page.getByText('Completada', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Subtotal:/)).toHaveText(money('Subtotal', expected.gross));
  await expect(page.getByText(/^Descuento:/)).toHaveText(
    money('Descuento', expected.discount ?? '0.00'),
  );
  await expect(page.getByText(/^Total:/)).toHaveText(money('Total', expected.net));
  await expect(page.getByText(/^Cliente:/)).toHaveText(
    `Cliente: ${expected.linked ? accounts().a.clientId : 'Sin cliente'}`,
  );
  await expect(page.getByText(/^Fecha de venta:/)).not.toContainText('No registrada');
  for (const item of expected.items)
    await expect(
      page.getByText(
        item.type === 'SERVICE' ? checkout.fixture().serviceName : checkout.fixture().productName,
        { exact: true },
      ),
    ).toBeVisible();
  if (expected.net === '0.00') {
    await expect(page.getByText('No hay pagos visibles', { exact: true })).toBeVisible();
    await expect(page.getByText(/impago|deuda|pago fallido|pago pendiente/i)).toHaveCount(0);
  } else
    await expect(page.getByText(/^Importe del pago:/)).toHaveText(
      money('Importe del pago', expected.net),
    );
  await expect(page.getByText(/Importe no disponible/)).toHaveCount(0);
  return { id, actual };
}

test('BF306-01 service checkout, persisted detail, replace and history', async ({ page }) => {
  await login(page, accounts().a);
  await open(page);
  await add(page, 'SERVICE');
  await pay(page);
  await submit(page);
  const expected = { gross: '15.01', net: '15.01', items: [service] };
  const { id, actual } = await detail(page, expected);
  await page.goBack();
  await expect(page).not.toHaveURL(/\/sales\/new/);
  await expect(button(page, 'Completar venta')).toHaveCount(0);
  assert.equal(checkout.snapshot().sales.length, 1);
  await page.goto('/sales');
  await button(page, /^Ver venta:/).click();
  await expect(page).toHaveURL(`${manifest.baseUrl}/sales/${id}`);
  evidence('bf306-01', expected, actual);
});

test('BF306-02 direct no-client product sale changes only its stock', async ({ page }) => {
  await login(page, accounts().a);
  await open(page);
  await add(page, 'PRODUCT');
  await page.getByLabel('Cantidad de producto de línea 1', { exact: true }).fill('2');
  await pay(page, 'Transferencia bancaria');
  await submit(page);
  const expected = {
    gross: '20.04',
    net: '20.04',
    method: 'BANK_TRANSFER',
    items: [{ ...product, quantity: 2 }],
  };
  const { actual } = await detail(page, expected);
  assert.equal(checkout.stock(), '18');
  assert.equal(checkout.stock('b'), '20');
  evidence('bf306-02', expected, actual);
});

test('BF306-03 mixed discount has exact persisted cents and deterministic analytics residual', async ({
  page,
}) => {
  const request = caller(page);
  await login(page, accounts().a);
  await open(page);
  await add(page, 'SERVICE');
  await add(page, 'PRODUCT');
  await page.getByLabel('Precio unitario opcional de línea 1', { exact: true }).fill('10.02');
  await page.getByLabel('Descuento global', { exact: true }).fill('0.01');
  await pay(page, 'Tarjeta de débito');
  await submit(page);
  const expected = {
    gross: '20.04',
    discount: '0.01',
    net: '20.03',
    method: 'DEBIT_CARD',
    items: [{ ...service, price: '10.02' }, product],
  };
  const { actual } = await detail(page, expected);
  // Equal gross lines and a 1-cent discount: PostgreSQL half-up allocation gives
  // the first stable UUID-ordered line the cent and the second line zero.
  const serviceFirst = actual.items[0].item_type === 'SERVICE';
  const day = actual.sales[0].sold_at.slice(0, 10);
  const bounds = {
    p_business_id: accounts().a.businessId,
    p_from: `${day}T00:00:00Z`,
    p_to: new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString(),
  }; // The synthetic business uses UTC; request one civil day, not decades of zero-fill.
  const analytics = await request('rpc/get_revenue_by_day', {
    ...bounds,
  });
  assert.equal(analytics.status, 200);
  assert.equal(analytics.data.length, 1);
  assert.equal(analytics.data[0].service_revenue, serviceFirst ? '10.01' : '10.02');
  assert.equal(analytics.data[0].product_revenue, serviceFirst ? '10.02' : '10.01');
  assert.equal(analytics.data[0].total_revenue, '20.03');
  const replay = await request('rpc/get_revenue_by_day', {
    ...bounds,
  });
  assert.deepEqual(replay.data, analytics.data);
  const finance = await request('rpc/get_dashboard_summary', bounds);
  assert.equal(finance.status, 200);
  assert.equal(finance.data.total_revenue, '20.03');
  assert.equal(finance.data.profit, '16.00'); // 20.03 net minus historical PRODUCT COGS 4.03.
  evidence('bf306-03', expected, actual);
});

test('BF306-04 full discount persists a free sale without payment or debt inference', async ({
  page,
}) => {
  await login(page, accounts().a);
  await open(page);
  await add(page, 'SERVICE');
  await page.getByLabel('Descuento global', { exact: true }).fill('15.01');
  await pay(page);
  await expect(page.getByText('No se registrará un cobro.', { exact: true })).toBeVisible();
  await submit(page);
  const expected = { gross: '15.01', discount: '15.01', net: '0.00', items: [service] };
  const { actual } = await detail(page, expected);
  evidence('bf306-04', expected, actual);
});

test('BF306-05 appointment explicit context derives client without copying historical lines', async ({
  page,
}) => {
  await login(page, accounts().a);
  await page.goto(`/appointments/${checkout.fixture().appointmentId}`);
  await button(page, 'Ir al checkout de esta cita').click();
  await expect(page.getByText('Sin servicios seleccionados', { exact: true })).toBeVisible();
  await expect(page.getByText('Sin productos seleccionados', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      `Cliente de la cita: ${accounts().a.clientId}. Los servicios se seleccionan explícitamente.`,
      { exact: true },
    ),
  ).toBeVisible();
  await add(page, 'SERVICE');
  await pay(page);
  await submit(page);
  const expected = { gross: '15.01', net: '15.01', linked: true, items: [service] };
  const { actual } = await detail(page, expected);
  evidence('bf306-05', expected, actual);
});

test('BF306-06 double tap and lost committed response explicitly replay the same operation', async ({
  page,
}) => {
  await login(page, accounts().a);
  await open(page);
  await add(page, 'PRODUCT');
  await pay(page);
  const payloads = [];
  let committed;
  const committedResponse = new Promise((resolve) => {
    committed = resolve;
  });
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/rest/v1/rpc/complete_checkout', async (route) => {
    payloads.push(route.request().postDataJSON());
    const response = await route.fetch(); // Real transaction is never mocked.
    if (payloads.length === 1) {
      assert.equal(response.status(), 200);
      committed();
      await barrier;
      await route.abort('timedout'); // Only delivery is fault-injected after commit.
    } else await route.fulfill({ response });
  });
  try {
    await button(page, 'Completar venta').scrollIntoViewIfNeeded();
    await button(page, 'Completar venta').evaluate((element) => {
      element.click();
      element.click();
    });
    await committedResponse;
    assert.equal(payloads.length, 1);
    assert.equal(checkout.snapshot().sales.length, 1);
    await expect(button(page, 'Cancelar venta')).toBeDisabled();
    release();
    await expect(button(page, 'Reintentar intención original')).toBeVisible();
    await expect(page.getByLabel('Descuento global', { exact: true })).toBeDisabled();
    await button(page, 'Reintentar intención original').click();
    await expect(page).toHaveURL(/\/sales\/[a-f0-9-]{36}$/);
    assert.equal(payloads.length, 2);
    assert.deepEqual(payloads[1], payloads[0]);
    const expected = { gross: '10.02', net: '10.02', items: [product] };
    const { actual } = await detail(page, expected);
    evidence('bf306-06', expected, actual);
  } finally {
    release();
  }
});

test('BF306-07 tenant B cannot list, read or reuse tenant A sale', async ({ page, browser }) => {
  await login(page, accounts().a);
  await open(page);
  await add(page, 'SERVICE');
  await pay(page);
  await submit(page);
  const id = checkout.snapshot().sales[0].id;
  const context = await browser.newContext({
    baseURL: manifest.baseUrl,
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  try {
    await restrictToLocal(context);
    const other = await context.newPage();
    const request = caller(other);
    await login(other, accounts().b);
    await other.goto('/sales');
    await expect(other.getByText('No hay ventas', { exact: true })).toBeVisible();
    const rows = await request(`sales?select=id&id=eq.${id}`);
    assert.equal(rows.status, 200);
    assert.deepEqual(rows.data, []);
    for (const resource of ['sale_items', 'payments']) {
      const children = await request(`${resource}?select=id&sale_id=eq.${id}`);
      assert.equal(children.status, 200);
      assert.deepEqual(children.data, []);
    }
    await other.goto(`/sales/${id}`);
    await expect(other.getByText('Venta no disponible.', { exact: true })).toBeVisible();
    await expect(other.getByText(`Venta: ${id}`, { exact: true })).toHaveCount(0);
    await expect(page.getByText(`Venta: ${id}`, { exact: true })).toBeVisible();
    assert.equal(checkout.snapshot('b').sales.length, 0);
  } finally {
    await context.close();
  }
});

test('BF306-08 BARBER has no quick action and cannot invoke financial checkout', async ({
  page,
}) => {
  checkout.demote();
  const request = caller(page);
  await login(page, accounts().a);
  await button(page, 'Acciones rápidas').click();
  await expect(button(page, 'Nueva venta')).toHaveCount(0);
  await page.goto('/sales/new');
  await expect(
    page.getByText('No tienes acceso para completar una venta.', { exact: true }),
  ).toBeVisible();
  await expect(button(page, 'Completar venta')).toHaveCount(0);
  const result = await request('rpc/complete_checkout', {
    p_business_id: accounts().a.businessId,
    p_operation_id: local.id('bf306-barber-operation'),
    p_appointment_id: null,
    p_client_id: null,
    p_discount_amount: '0.00',
    p_payment_method: 'CASH',
    p_items: [{ itemType: 'SERVICE', itemId: checkout.fixture().serviceId, quantity: 1 }],
  });
  assert.equal(result.status, 403);
  assert.equal(result.data.code, '42501');
  assert.equal(checkout.snapshot().sales.length, 0);
  assert.equal(checkout.stock(), '20');
});

test('BF306-09 archived-after-review catalog rejection rolls back all effects and preserves input', async ({
  page,
}) => {
  await login(page, accounts().a);
  await open(page);
  await add(page, 'SERVICE');
  await add(page, 'PRODUCT');
  await pay(page);
  checkout.deactivateService(); // Authoritative catalog changes after the UI review, before submit.
  await button(page, 'Completar venta').click();
  await expect(button(page, 'Editar con una nueva intención')).toBeVisible();
  await expect(page.getByText('Revisa los datos de la venta.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/sales\/new$/);
  assert.equal(checkout.snapshot().sales.length, 0);
  assert.equal(checkout.snapshot().items.length, 0);
  assert.equal(checkout.snapshot().payments.length, 0);
  assert.equal(checkout.stock(), '20');
  await button(page, 'Editar con una nueva intención').click();
  await expect(button(page, 'Quitar servicio de línea 1')).toBeVisible();
  await expect(page.getByLabel('Cantidad de producto de línea 1', { exact: true })).toHaveValue(
    '1',
  );
});
