const assert = require('node:assert/strict');
const {
  test: base,
  expect,
  accounts,
  login,
  caller,
  restrictToLocal,
} = require('../helpers/auth.cjs');
const { manifest } = require('../helpers/environment.cjs');
const purchase = require('../../../scripts/e2e/purchase.cjs');
const local = require('../../../scripts/e2e/local.cjs');

let index = 0;
const test = base.extend({
  baseline: [
    async ({ browserName }, run) => {
      assert.equal(browserName, 'chromium');
      if (index++ > 0) purchase.reset(accounts());
      await run();
    },
    { auto: true, timeout: 60000 },
  ],
});
test.afterEach(() => local.softReset(accounts()));

const a = purchase.fixture();
const b = purchase.fixture('b');
const button = (page, name) => page.getByRole('button', { name, exact: true });
const label = (page, name) => page.getByLabel(name, { exact: true });
const text = (page, value) => page.getByText(value, { exact: true });
const amount = (value) => 'ARS\u00a0' + value.replace('.', ',');
const purchaseRoute = /\/purchases\/[a-f0-9-]{36}$/;

async function form(page, lines = purchase.control) {
  await page.goto('/purchases');
  await expect(text(page, 'No hay compras registradas')).toBeVisible();
  await button(page, 'Nueva compra').click();
  await expect(page).toHaveURL(/\/purchases\/new$/);
  await label(page, 'Proveedor (obligatorio)').fill(purchase.supplier);
  await label(page, 'Fecha y hora de compra (ISO con zona)').fill(purchase.purchasedAt);
  await label(page, 'Notas').fill(purchase.notes);
  await button(page, 'Método: Efectivo').click();
  await button(page, 'Categoría de gasto: ' + purchase.categoryName).click();
  for (const [i, line] of lines.entries()) {
    const product = a.products[line.product - 1];
    await button(page, 'Agregar producto: ' + product.name).click();
    await expect(text(page, product.name)).toBeVisible();
    await label(page, 'Cantidad de línea ' + (i + 1)).fill(String(line.quantity));
    await label(page, 'Costo unitario de línea ' + (i + 1)).fill(line.unitCost);
  }
}

async function submit(page) {
  await button(page, 'Registrar compra').click();
  await expect(page).toHaveURL(purchaseRoute);
}

async function detail(page, row, lines = purchase.control) {
  await expect(page).toHaveURL(manifest.baseUrl + '/purchases/' + row.id);
  const supplier = page.getByRole('heading', { name: purchase.supplier, exact: true });
  await expect(supplier).toBeVisible();
  await expect(
    text(supplier.locator('..'), row.status === 'VOIDED' ? 'Anulada' : 'Completada'),
  ).toBeVisible();
  await expect(text(page, 'Total: ' + amount(row.total))).toBeVisible();
  await expect(text(page, 'Fecha del gasto: ' + purchase.expenseDate)).toBeVisible();
  await expect(page.getByText(/^Fecha de compra:/)).toHaveText(/1\/11\/26.*12:30/);
  await expect(text(page, 'Notas: ' + purchase.notes)).toBeVisible();
  await expect(text(page, 'Importe registrado: ' + amount(row.total))).toBeVisible();
  await expect(text(page, 'Categoría: ' + purchase.categoryName)).toBeVisible();
  await expect(text(page, 'Medio de pago: Efectivo')).toBeVisible();
  for (const line of lines) {
    await expect(text(page, a.products[line.product - 1].name).first()).toBeVisible();
    await expect(text(page, 'Cantidad: ' + line.quantity)).toBeVisible();
    await expect(text(page, 'Costo unitario histórico: ' + amount(line.unitCost))).toBeVisible();
    await expect(text(page, 'Importe: ' + amount(line.lineTotal))).toBeVisible();
  }
  await expect(page.getByText(/Importe no disponible|Gasto histórico no disponible/)).toHaveCount(
    0,
  );
}

async function history(page, id) {
  await expect(page).toHaveURL(manifest.baseUrl + '/purchases');
  await expect(button(page, 'Anular compra')).toHaveCount(0);
  const row = page.getByRole('button', { name: /^Ver compra: BF307 Proveedor,/ });
  await expect(row).toBeVisible();
  await expect(text(page, 'No hay compras registradas')).toHaveCount(0);
  await row.click();
  await expect(page).toHaveURL(manifest.baseUrl + '/purchases/' + id);
}

async function finance(request, purchaseTotal, day = purchase.expenseDate, nextDay = '2026-11-02') {
  const bounds = {
    p_business_id: a.businessId,
    p_from: day + 'T00:00:00Z',
    p_to: nextDay + 'T00:00:00Z',
  };
  const [dashboard, expenses] = await Promise.all([
    request('rpc/get_dashboard_summary', bounds),
    request('rpc/get_expense_summary', bounds),
  ]);
  assert.equal(dashboard.status, 200);
  assert.equal(expenses.status, 200);
  assert.deepEqual(
    [
      dashboard.data.total_revenue,
      dashboard.data.profit,
      dashboard.data.expenses,
      dashboard.data.merchandise_purchases,
    ],
    ['0.00', '0.00', '0.00', purchaseTotal],
  );
  assert.deepEqual(
    [expenses.data.manual_total, expenses.data.purchase_total, expenses.data.total],
    ['0.00', purchaseTotal, purchaseTotal],
  );
}

async function stock(request, expected) {
  const result = await request('rpc/get_product_stock', {
    p_business_id: a.businessId,
    p_product_ids: a.products.map((p) => p.id),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(
    Object.fromEntries(result.data.map((row) => [row.product_id, row.current_stock])),
    Object.fromEntries(a.products.map((p, i) => [p.id, expected[i]])),
  );
}

function voidPayload(id) {
  return {
    p_business_id: a.businessId,
    p_operation_id: local.id('bf307-void'),
    p_purchase_id: id,
    p_reason: purchase.reason,
  };
}

async function startVoid(page) {
  await button(page, 'Anular compra').click();
  const dialog = page.getByRole('dialog', { name: 'Anular compra' });
  await dialog.getByLabel('Motivo de la anulación', { exact: true }).fill(purchase.reason);
  await button(dialog, 'Confirmar anulación').click();
  return dialog;
}

test('BF307-01 control purchase, history, immutable records and no double accounting', async ({
  page,
}) => {
  const request = caller(page);
  await login(page, accounts().a);
  const baseline = purchase.snapshot();
  purchase.verifyBaseline(baseline);
  await stock(request, ['10', '7']);
  await finance(request, '0.00');
  await form(page);
  await expect(text(page, 'Total estimado: ' + amount('30.00'))).toBeVisible();
  await submit(page);
  const persisted = purchase.snapshot();
  const row = purchase.verify(baseline, persisted);
  await detail(page, row);
  await stock(request, ['15', '7']);
  await finance(request, '30.00');
  await page.goBack();
  await expect(page).not.toHaveURL(/\/purchases\/new$/);
  await expect(button(page, 'Registrar compra')).toHaveCount(0);
  await history(page, row.id);
  await page.reload();
  await detail(page, row);
  await expect(page.getByRole('button', { name: /^(Editar|Eliminar)( compra)?$/ })).toHaveCount(0);
  for (const [resource, id] of [
    ['purchases', row.id],
    ['purchase_items', persisted.items[0].id],
  ]) {
    for (const [method, body] of [
      ['PATCH', resource === 'purchases' ? { supplier: 'BF307 Alterado' } : { quantity: 9 }],
      ['DELETE', undefined],
    ]) {
      const result = await request(resource + '?id=eq.' + id, body, method);
      assert.ok(
        result.status === 403 || result.status === 204,
        'Direct DML must be denied or affect no visible rows',
      );
      assert.deepEqual(purchase.snapshot(), persisted);
    }
  }
});

test('BF307-02 multi-line purchase and replay-safe historical correction', async ({ page }) => {
  const request = caller(page);
  await login(page, accounts().a);
  const baseline = purchase.snapshot();
  await form(page, purchase.multi);
  await submit(page);
  const completed = purchase.snapshot();
  const row = purchase.verify(baseline, completed, purchase.multi, '36.21');
  await detail(page, row, purchase.multi);
  await stock(request, ['15', '10']);
  await finance(request, '36.21');
  const sent = [];
  await page.route('**/rest/v1/rpc/void_purchase', async (route) => {
    sent.push(route.request().postDataJSON());
    await route.continue();
  });
  await startVoid(page);
  await expect(text(page, 'Compra anulada en BarberFlow')).toBeVisible();
  assert.equal(sent.length, 1);
  const corrected = purchase.snapshot();
  purchase.verifyVoid(completed, corrected, sent[0].p_operation_id);
  await page.unroute('**/rest/v1/rpc/void_purchase');
  const replay = await request('rpc/void_purchase', sent[0]);
  assert.equal(replay.status, 200);
  assert.deepEqual(purchase.snapshot(), corrected);
  await stock(request, ['10', '7']);
  await finance(request, '0.00');
  await page.reload();
  await detail(page, corrected.purchases[0], purchase.multi);
  await expect(text(page, 'Motivo: ' + purchase.reason)).toBeVisible();
  await expect(text(page, 'Cantidad descontada del stock: 5')).toBeVisible();
  await expect(text(page, 'Cantidad descontada del stock: 3')).toBeVisible();
  await expect(button(page, 'Anular compra')).toHaveCount(0);
});

test('BF307-03 committed response loss and double submit reuse a single purchase intention', async ({
  page,
}) => {
  await login(page, accounts().a);
  const baseline = purchase.snapshot();
  await form(page);
  const attempts = [];
  const committed = Promise.withResolvers();
  const release = Promise.withResolvers();
  await page.route('**/rest/v1/rpc/complete_purchase', async (route) => {
    attempts.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (attempts.length === 1) {
      committed.resolve(response.status());
      await release.promise;
      await route.abort('timedout');
    } else {
      await route.fulfill({ response });
    }
  });
  try {
    const register = button(page, 'Registrar compra');
    await register.scrollIntoViewIfNeeded();
    await register.evaluate((element) => {
      element.click();
      element.click();
    });
    assert.equal(await committed.promise, 200);
    assert.equal(attempts.length, 1);
    await expect(button(page, 'Cancelar compra')).toBeDisabled();
    const first = purchase.snapshot();
    const row = purchase.verify(baseline, first);
    assert.equal(row.operation_id, attempts[0].p_operation_id);
    release.resolve();
    await expect(button(page, 'Reintentar compra original')).toBeVisible();
    await expect(label(page, 'Proveedor (obligatorio)')).toBeDisabled();
    await button(page, 'Reintentar compra original').click();
    await detail(page, row);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1], attempts[0]);
    assert.deepEqual(purchase.snapshot(), first);
  } finally {
    release.resolve();
  }
});

test('BF307-04 invalid quantity and cost leave both lines and all financial effects unwritten', async ({
  page,
}) => {
  const request = caller(page);
  await login(page, accounts().a);
  const baseline = purchase.snapshot();
  await form(page, purchase.multi);
  await label(page, 'Cantidad de línea 2').fill('0');
  await button(page, 'Registrar compra').click();
  await expect(text(page, 'Error: La cantidad debe ser mayor que cero.')).toBeVisible();
  await label(page, 'Cantidad de línea 2').fill('3');
  await label(page, 'Costo unitario de línea 2').fill('-2.07');
  await button(page, 'Registrar compra').click();
  await expect(text(page, 'Error: Ingresa un costo no negativo con dos decimales.')).toBeVisible();
  assert.deepEqual(purchase.snapshot(), baseline);
  const payload = purchase.payload('a', 'invalid');
  for (const invalid of [
    { quantity: 0, unitCost: '2.07' },
    { quantity: 3, unitCost: '-2.07' },
  ]) {
    const rejected = await request('rpc/complete_purchase', {
      ...payload,
      p_items: [...payload.p_items, { productId: a.products[1].id, ...invalid }],
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.data.code, '22023');
    assert.deepEqual(purchase.snapshot(), baseline);
  }
});

test('BF307-05 negative-stock correction is rejected without partial compensation', async ({
  page,
}) => {
  const request = caller(page);
  await login(page, accounts().a);
  const baseline = purchase.snapshot();
  await form(page, purchase.multi);
  await submit(page);
  const row = purchase.verify(baseline, purchase.snapshot(), purchase.multi, '36.21');
  const loss = await request('rpc/adjust_stock', {
    p_business_id: a.businessId,
    p_operation_id: local.id('bf307-loss'),
    p_product_id: a.products[1].id,
    p_quantity_delta: -8,
    p_reason: 'LOSS',
    p_notes: null,
  });
  assert.equal(loss.status, 200);
  await stock(request, ['15', '2']);
  const before = purchase.snapshot();
  const dialog = await startVoid(page);
  await expect(
    dialog.getByText('No hay stock suficiente para revertir completamente esta compra.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByText(/PT409|INSUFFICIENT_STOCK/)).toHaveCount(0);
  assert.deepEqual(purchase.snapshot(), before);
  await finance(request, '36.21');
  await button(dialog, 'Cancelar').click();
  await page.reload();
  await detail(page, row, purchase.multi);
});

test('BF307-06 foreign OWNER and same-tenant BARBER cannot access or mutate the purchase', async ({
  page,
  browser,
}) => {
  await login(page, accounts().a);
  const baseline = purchase.snapshot();
  const otherBaseline = purchase.snapshot('b');
  await form(page);
  await submit(page);
  const persisted = purchase.snapshot();
  const row = purchase.verify(baseline, persisted);
  for (const [role, user] of [
    ['owner', accounts().b],
    ['barber', accounts().barber],
  ]) {
    const context = await browser.newContext({
      baseURL: manifest.baseUrl,
      serviceWorkers: 'block',
    });
    try {
      await restrictToLocal(context);
      const other = await context.newPage();
      const request = caller(other);
      await login(other, user);
      if (role === 'barber') {
        await button(other, 'Acciones rápidas').click();
        await expect(button(other, 'Ingresar mercadería')).toHaveCount(0);
      }
      await other.goto('/purchases');
      if (role === 'barber') {
        await expect(text(other, 'Acceso restringido')).toBeVisible();
        await expect(button(other, 'Nueva compra')).toHaveCount(0);
        await other.goto('/purchases/new');
        await expect(text(other, 'Acceso restringido')).toBeVisible();
        await expect(button(other, 'Registrar compra')).toHaveCount(0);
      } else {
        await expect(text(other, 'No hay compras registradas')).toBeVisible();
      }
      await other.goto('/purchases/' + row.id);
      await expect(
        other.getByText(role === 'barber' ? 'Acceso restringido' : 'Compra no disponible.', {
          exact: false,
        }),
      ).toBeVisible();
      await expect(text(other, purchase.supplier)).toHaveCount(0);
      for (const filter of [
        'purchases?select=id&id=eq.' + row.id,
        'purchase_items?select=id&purchase_id=eq.' + row.id,
        'expenses?select=id&purchase_id=eq.' + row.id,
      ]) {
        const result = await request(filter);
        assert.equal(result.status, 200);
        assert.deepEqual(result.data, []);
      }
      for (const [rpc, payload] of [
        ['get_purchase_detail', { p_business_id: a.businessId, p_purchase_id: row.id }],
        ['void_purchase', voidPayload(row.id)],
        ['complete_purchase', purchase.payload('a', role)],
      ]) {
        const denied = await request('rpc/' + rpc, payload);
        assert.equal(denied.status, 403);
        assert.equal(denied.data.code, '42501');
      }
      if (role === 'owner') {
        const own = purchase.payload('b', 'foreign-product');
        assert.equal(own.p_business_id, b.businessId);
        const denied = await request('rpc/complete_purchase', {
          ...own,
          p_items: [{ ...own.p_items[0], productId: a.products[0].id }],
        });
        assert.equal(denied.status, 400);
        assert.equal(denied.data.code, '22023');
        const foreignVoid = await request('rpc/void_purchase', {
          ...voidPayload(row.id),
          p_business_id: b.businessId,
        });
        assert.equal(foreignVoid.status, 403);
      }
      assert.deepEqual(purchase.snapshot(), persisted);
      assert.deepEqual(purchase.snapshot('b'), otherBaseline);
    } finally {
      await context.close();
    }
  }
});
