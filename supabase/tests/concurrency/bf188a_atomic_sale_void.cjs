// Synthetic fixtures, LOCAL container only; final reset removes committed races.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { query, Session, blocked } = require('../helpers/local-postgres.cjs');
const { saleVoidFixture } = require('../helpers/sale-void-fixture.cjs');
const parse = (value) =>
  value
    .split('\n')
    .filter((x) => x.startsWith('{'))
    .map(JSON.parse)
    .at(-1);
function createSale() {
  const f = saleVoidFixture();
  const out = parse(
    query(
      `BEGIN;${f.sql}${f.identity()}SET LOCAL ROLE authenticated;SELECT ${f.checkout(randomUUID())};COMMIT;`,
    ),
  );
  const target = `'${out.sale.id}'`;
  return {
    ...f,
    original: out,
    expr: (op = f.operation, reason = 'reason') => f.voidSale(op, reason, f.business, target),
    read: () => f.reader(f.business, target),
  };
}
const begin = (s, f) => s.sql(`BEGIN;${f.identity()}SET LOCAL ROLE authenticated;`);
const stats = (f) =>
  JSON.parse(
    query(`SELECT jsonb_build_object(
 'audit',(SELECT count(*) FROM private.sale_voids WHERE business_id='${f.business}'),
 'returns',(SELECT count(*) FROM public.stock_movements WHERE business_id='${f.business}' AND reference_type='SALE_VOID'),
 'balance',(SELECT sum(quantity_delta) FROM public.stock_movements WHERE product_id='${f.product}'),
 'status',(SELECT status FROM public.sales WHERE id='${f.original.sale.id}'));`),
  );
async function connections(body) {
  const a = await new Session().init(),
    b = await new Session().init();
  try {
    await body(a, b);
  } finally {
    await b.close();
    await a.close();
  }
}
for (const mode of ['same-key', 'different-key', 'different-reason', 'rollback'])
  test(`BF188A real overlapping ${mode} serializes one correction and one RETURN set`, async () => {
    const f = createSale();
    await connections(async (a, b) => {
      await begin(a, f);
      const first = parse(await a.sql(`SELECT ${f.expr()};`));
      await begin(b, f);
      const expression = f.expr(
        mode === 'different-key' || mode === 'rollback' ? randomUUID() : f.operation,
        mode === 'different-reason' ? 'changed' : 'reason',
      );
      const pending = b.sql(
        mode === 'different-key' || mode === 'different-reason'
          ? f.expect(expression, 'PT409', mode === 'different-key' ? 'INVALID_STATUS' : 'CONFLICT')
          : `SELECT ${expression};`,
      );
      await blocked(b, a);
      assert.equal(stats(f).audit, 0, 'uncommitted correction is not visible');
      await a.sql(mode === 'rollback' ? 'ROLLBACK;' : 'COMMIT;');
      const result = await pending;
      if (mode === 'same-key') assert.deepEqual(parse(result), first);
      if (mode === 'rollback') assert.equal(parse(result).sale.status, 'VOIDED');
      await b.sql('COMMIT;');
    });
    assert.deepEqual(stats(f), { audit: 1, returns: 2, balance: 2, status: 'VOIDED' });
  });
test('BF188A same correction key on different sales has one winner', async () => {
  const f = createSale();
  const other = parse(
    query(
      `BEGIN;${f.identity()}SET LOCAL ROLE authenticated;SELECT ${f.checkout(randomUUID(), { appointmentId: null, items: [{ itemType: 'SERVICE', itemId: f.service, quantity: 1 }] })};COMMIT;`,
    ),
  );
  await connections(async (a, b) => {
    await begin(a, f);
    await a.sql(`SELECT ${f.expr()};`);
    await begin(b, f);
    const pending = b.sql(
      f.expect(
        f.voidSale(f.operation, 'reason', f.business, `'${other.sale.id}'`),
        'PT409',
        'CONFLICT',
      ),
    );
    await blocked(b, a);
    await a.sql('COMMIT;');
    await pending;
    await b.sql('COMMIT;');
  });
  assert.deepEqual(stats(f), { audit: 1, returns: 2, balance: 2, status: 'VOIDED' });
});
for (const change of ['is_active=false', "role='BARBER'"])
  test(`BF188A reauthorizes ${change} after product-lock wait`, async () => {
    const f = createSale();
    await connections(async (a, b) => {
      await a.sql(`BEGIN;SELECT id FROM public.products WHERE id='${f.product}' FOR UPDATE;`);
      await begin(b, f);
      const pending = b.sql(f.expect(f.expr(), '42501', 'ACCESS_DENIED'));
      await blocked(b, a);
      query(`UPDATE public.business_members SET ${change} WHERE id='${f.ownerMember}';`);
      await a.sql('COMMIT;');
      await pending;
      await b.sql('COMMIT;');
    });
    assert.deepEqual(stats(f), { audit: 0, returns: 0, balance: 0, status: 'COMPLETED' });
  });
test('BF188A correction shares product anchor with an actual stock adjustment', async () => {
  const f = createSale();
  await connections(async (a, b) => {
    await a.sql(`BEGIN;SELECT id FROM public.products WHERE id='${f.product}' FOR UPDATE;`);
    await begin(b, f);
    const pending = b.sql(`SELECT ${f.expr()};`);
    await blocked(b, a);
    await a.sql(
      `${f.identity()}SET LOCAL ROLE authenticated;SELECT public.adjust_stock('${f.business}','${randomUUID()}','${f.product}',1,'ADJUSTMENT','race');COMMIT;`,
    );
    await pending;
    await b.sql('COMMIT;');
  });
  assert.deepEqual(stats(f), { audit: 1, returns: 2, balance: 3, status: 'VOIDED' });
});
test('BF188A void vs new checkout shares product locks without a lost RETURN', async () => {
  const f = createSale();
  await connections(async (a, b) => {
    await begin(a, f);
    await a.sql(`SELECT ${f.expr()};`);
    await begin(b, f);
    const pending = b.sql(
      `SELECT ${f.checkout(randomUUID(), { appointmentId: null, items: [{ itemType: 'PRODUCT', itemId: f.product, quantity: 1 }] })};`,
    );
    await blocked(b, a);
    await a.sql('COMMIT;');
    assert.equal(parse(await pending).sale.status, 'COMPLETED');
    await b.sql('COMMIT;');
  });
  assert.deepEqual(stats(f), { audit: 1, returns: 2, balance: 1, status: 'VOIDED' });
});
test('BF188A checkout replay concurrent with void never reapplies a debit', async () => {
  const f = createSale();
  await connections(async (a, b) => {
    await begin(a, f);
    await a.sql(`SELECT ${f.expr()};`);
    await begin(b, f);
    const pending = b.sql(
      `SELECT ${f.checkout(f.original.sale.operation_id, { items: null, discount: null, method: null })};`,
    );
    await blocked(b, a);
    await a.sql('COMMIT;');
    assert.equal(parse(await pending).sale.status, 'VOIDED');
    await b.sql('COMMIT;');
  });
  assert.deepEqual(stats(f), { audit: 1, returns: 2, balance: 2, status: 'VOIDED' });
});
test('BF188A historical reader sees committed complete snapshots only', async () => {
  const f = createSale();
  await connections(async (a, b) => {
    await begin(a, f);
    const out = parse(await a.sql(`SELECT ${f.expr()};`));
    await begin(b, f);
    assert.deepEqual(parse(await b.sql(`SELECT ${f.read()};`)), {
      correction: null,
      stockMovements: [],
    });
    await a.sql('COMMIT;');
    assert.deepEqual(parse(await b.sql(`SELECT ${f.read()};`)), {
      correction: out.correction,
      stockMovements: out.stockMovements,
    });
    await b.sql('COMMIT;');
  });
});
