const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  test: base,
  expect,
  accounts,
  login,
  caller,
  restrictToLocal,
} = require('../helpers/auth.cjs');
const { manifest } = require('../helpers/environment.cjs');
const checkout = require('../../../scripts/e2e/checkout.cjs');
const stock = require('../../../scripts/e2e/insufficient-stock.cjs');
const { contend } = require('../../../scripts/e2e/stock-race.cjs');
const local = require('../../../scripts/e2e/local.cjs');

let caseIndex = 0;
const test = base.extend({
  stockBaseline: [
    async ({ browserName }, run) => {
      assert.equal(browserName, 'chromium');
      if (caseIndex++ > 0) stock.reset(accounts());
      stock.baseline();
      await run();
    },
    { auto: true, timeout: 60000 },
  ],
});
test.afterEach(() => local.softReset(accounts()));

const product = checkout.fixture();
const button = (page, name) => page.getByRole('button', { name, exact: true });
const quantity = (page) => page.getByLabel('Cantidad de producto de línea 1', { exact: true });
const submit = (page) => button(page, 'Completar venta');
const errorMessage = 'No hay stock suficiente para completar la venta.';
const edit = (page) => button(page, 'Editar con una nueva intención');
const rpc = (request, payload) => request('rpc/complete_checkout', payload);

function input(label, amount, business = accounts().a.businessId) {
  return {
    p_business_id: business,
    p_operation_id: local.id(`bf308-${label}`),
    p_appointment_id: null,
    p_client_id: null,
    p_discount_amount: '0.00',
    p_payment_method: 'CASH',
    p_items: [{ itemType: 'PRODUCT', itemId: product.productId, quantity: amount }],
  };
}

function responseCode({ status, data }) {
  return { status, code: data.code, details: data.details };
}

function insufficient(response) {
  assert.deepEqual(responseCode(response), {
    status: 409,
    code: 'PT409',
    details: 'INSUFFICIENT_STOCK',
  });
}

async function adjust(request, name, delta) {
  assert.ok(delta === 1 || delta === -1);
  const { status, data } = await request('rpc/adjust_stock', {
    p_business_id: accounts().a.businessId,
    p_operation_id: local.id(`bf308-adjust-${name}`),
    p_product_id: product.productId,
    p_quantity_delta: delta,
    p_reason: 'ADJUSTMENT',
    p_notes: null,
  });
  assert.equal(status, 200);
  assert.equal(data.quantity_delta, delta);
}

async function open(page, linked = false) {
  if (linked) {
    await page.goto(`/appointments/${product.appointmentId}`);
    await button(page, 'Ir al checkout de esta cita').click();
    await button(page, `Agregar servicio: ${product.serviceName}`).click();
  } else {
    await button(page, 'Acciones rápidas').click();
    await button(page, 'Nueva venta').click();
    await expect(page).toHaveURL(/\/sales\/new$/);
  }
  await button(page, `Agregar producto: ${product.productName}`).click();
}

async function readStock(page, available, demand) {
  await expect(
    page.getByText(`Stock disponible: ${available} · Demanda total del producto: ${demand}`, {
      exact: true,
    }),
  ).toBeVisible();
}

async function submitObserved(page) {
  const observed = page.waitForResponse(
    (response) =>
      response.url() === `${manifest.supabaseUrl}/rest/v1/rpc/complete_checkout` &&
      response.request().method() === 'POST',
  );
  await submit(page).click();
  const response = await observed;
  return {
    status: response.status(),
    data: await response.json(),
    operation: response.request().postDataJSON().p_operation_id,
  };
}

async function safeError(page) {
  await expect(page.getByText(errorMessage, { exact: true })).toBeVisible();
  await expect(edit(page)).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Detalle de venta', exact: true })).toHaveCount(0);
  await expect(
    page.getByText(/PT409|INSUFFICIENT_STOCK|stock_movements|service_role|Insufficient stock/),
  ).toHaveCount(0);
  await expect(quantity(page)).toHaveValue('2');
}

async function detail(page, id) {
  await expect(page).toHaveURL(`${manifest.baseUrl}/sales/${id}`);
  await expect(page.getByText('Total: ARS 10,02', { exact: true })).toBeVisible();
  await expect(page.getByText('Importe del pago: ARS 10,02', { exact: true })).toBeVisible();
}

async function revenue(request) {
  const now = Date.now();
  const { status, data } = await request('rpc/get_dashboard_summary', {
    p_business_id: accounts().a.businessId,
    p_from: new Date(now - 86400000).toISOString(),
    p_to: new Date(now + 86400000).toISOString(),
  });
  assert.equal(status, 200);
  assert.equal(data.total_revenue, '0.00');
}

test('BF308-01 control consumes the only unit with one sale, line and payment', async ({
  page,
}) => {
  const before = checkout.snapshot();
  await login(page, accounts().a);
  await open(page);
  await readStock(page, 1, 1);
  await button(page, 'Método de pago: Efectivo').click();
  const response = await submitObserved(page);
  assert.equal(response.status, 200);
  await detail(page, stock.soldOne(before, checkout.snapshot(), response.operation));
});

test('BF308-02 fresh UI prevents excess demand and real authenticated RPC rejects it twice', async ({
  page,
}) => {
  const request = caller(page);
  const before = checkout.snapshot();
  await login(page, accounts().a);
  await open(page);
  await quantity(page).fill('2');
  await readStock(page, 1, 2);
  await button(page, 'Método de pago: Efectivo').click();
  await expect(submit(page)).toBeDisabled();
  await expect(
    page.getByText('Stock insuficiente para la demanda total.', { exact: true }),
  ).toBeVisible();
  const operation = input('same-rejected-intent', 2);
  for (let attempt = 0; attempt < 2; attempt++) {
    insufficient(await rpc(request, operation));
    stock.rejected(before, checkout.snapshot(), 1);
  }
  await revenue(request);
});

test('BF308-03 stale UI receives stock rejection and recovers with one new intention', async ({
  page,
}) => {
  const request = caller(page);
  await login(page, accounts().a);
  await adjust(request, 'stale-prepare', 1);
  await open(page);
  await quantity(page).fill('2');
  await readStock(page, 2, 2);
  await button(page, 'Método de pago: Efectivo').click();
  await expect(submit(page)).toBeEnabled();
  await adjust(request, 'stale-loss', -1);
  const before = checkout.snapshot();
  await readStock(page, 2, 2);
  const failed = await submitObserved(page);
  insufficient(failed);
  await safeError(page);
  await expect(page).toHaveURL(/\/sales\/new$/);
  stock.rejected(before, checkout.snapshot(), 1);
  await revenue(request);
  await edit(page).click();
  await expect(quantity(page)).toHaveValue('2');
  await quantity(page).fill('1');
  await expect(page.getByText(errorMessage, { exact: true })).toHaveCount(0);
  const recovered = await submitObserved(page);
  assert.equal(recovered.status, 200);
  assert.notEqual(recovered.operation, failed.operation);
  await detail(page, stock.soldOne(before, checkout.snapshot(), recovered.operation));
});

test('BF308-04 stale mixed appointment checkout leaves both lines and appointment unchanged', async ({
  page,
}) => {
  const request = caller(page);
  await login(page, accounts().a);
  await adjust(request, 'mixed-prepare', 1);
  await open(page, true);
  await quantity(page).fill('2');
  await readStock(page, 2, 2);
  await button(page, 'Método de pago: Efectivo').click();
  await adjust(request, 'mixed-loss', -1);
  const before = checkout.snapshot();
  await readStock(page, 2, 2);
  insufficient(await submitObserved(page));
  await safeError(page);
  stock.rejected(before, checkout.snapshot(), 1);
  await revenue(request);
});

test('BF308-05 five real PostgreSQL races consume one last unit per round', async ({ page }) => {
  const request = caller(page);
  const rounds = [];
  await login(page, accounts().a);
  for (let round = 1; round <= 5; round++) {
    if (round > 1) await adjust(request, `race-${round}`, 1);
    const before = checkout.snapshot();
    stock.assertLedger(before.movements, 1);
    for (let observationNumber = 0; observationNumber < 2; observationNumber++) {
      const observation = await request('rpc/get_product_stock', {
        p_business_id: accounts().a.businessId,
        p_product_ids: [product.productId],
      });
      assert.deepEqual(observation.data, [{ product_id: product.productId, current_stock: '1' }]);
    }
    const intents = [input(`race-${round}-a`, 1), input(`race-${round}-b`, 1)];
    const [a, b] = await contend(
      () => rpc(request, intents[0]),
      () => rpc(request, intents[1]),
    );
    const responses = [a, b];
    const winner = responses.findIndex((response) => response.status === 200);
    assert.notEqual(winner, -1);
    insufficient(responses[1 - winner]);
    stock.soldOne(before, checkout.snapshot(), intents[winner].p_operation_id);
    rounds.push({
      round,
      before: 1,
      intentA: winner === 0 ? 'SUCCESS' : 'INSUFFICIENT_STOCK',
      intentB: winner === 1 ? 'SUCCESS' : 'INSUFFICIENT_STOCK',
      after: 0,
      sales: 1,
      debits: 1,
    });
  }
  fs.writeFileSync(
    path.join(process.env.E2E_RUN_DIRECTORY, 'bf308-race-rounds.json'),
    JSON.stringify(rounds),
  );
});

test('BF308-06 other tenant cannot see stock or sale or use a foreign product', async ({
  page,
  browser,
}) => {
  const request = caller(page);
  const before = checkout.snapshot();
  await login(page, accounts().a);
  const saleInput = input('tenant-owner-a', 1);
  assert.equal((await rpc(request, saleInput)).status, 200);
  const sold = checkout.snapshot();
  const saleId = stock.soldOne(before, sold, saleInput.p_operation_id);
  const context = await browser.newContext({ baseURL: manifest.baseUrl, serviceWorkers: 'block' });
  try {
    await restrictToLocal(context);
    const other = await context.newPage();
    const otherRequest = caller(other);
    const otherBefore = checkout.snapshot('b');
    await login(other, accounts().b);
    const foreignStock = await otherRequest('rpc/get_product_stock', {
      p_business_id: accounts().a.businessId,
      p_product_ids: [product.productId],
    });
    assert.equal(foreignStock.status, 403);
    const hiddenProduct = await otherRequest('rpc/get_product_stock', {
      p_business_id: accounts().b.businessId,
      p_product_ids: [product.productId],
    });
    assert.deepEqual(hiddenProduct, { status: 200, data: [] });
    assert.equal(
      (await rpc(otherRequest, input('tenant-owner-b', 1, accounts().b.businessId))).data.code,
      '22023',
    );
    assert.deepEqual(await otherRequest(`sales?select=id&id=eq.${saleId}`), {
      status: 200,
      data: [],
    });
    await other.goto(`/sales/${saleId}`);
    await expect(other.getByText('Venta no disponible.', { exact: true })).toBeVisible();
    stock.rejected(otherBefore, checkout.snapshot('b'), 1);
    stock.rejected(sold, checkout.snapshot(), 0);
  } finally {
    await context.close();
  }
});

test('BF308-07 BARBER cannot sell and archived product rejection remains atomic', async ({
  page,
}) => {
  const request = caller(page);
  const before = checkout.snapshot();
  await login(page, accounts().a);
  local.sql(`UPDATE public.products SET is_active=false WHERE id='${product.productId}';`);
  assert.equal((await rpc(request, input('archived', 1))).data.code, '22023');
  stock.rejected(before, checkout.snapshot(), 1);
  checkout.demote();
  await page.goto('/sales/new');
  await expect(
    page.getByText('No tienes acceso para completar una venta.', { exact: true }),
  ).toBeVisible();
  await expect(submit(page)).toHaveCount(0);
  const denied = await rpc(request, input('barber', 1));
  assert.equal(denied.status, 403);
  assert.equal(denied.data.code, '42501');
  stock.rejected(before, checkout.snapshot(), 1);
});
