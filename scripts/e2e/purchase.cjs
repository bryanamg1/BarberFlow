const assert = require('node:assert/strict');
const local = require('./local.cjs');
const { cents } = require('./checkout.cjs');
const { guard } = require('../../tests/e2e/helpers/environment.cjs');

const supplier = 'BF307 Proveedor';
const categoryName = 'BF307 Mercaderia';
const purchasedAt = '2026-11-01T12:30:00Z';
const expenseDate = '2026-11-01';
const notes = 'BF307 Notas';
const reason = 'BF307 Correccion';
const control = [{ product: 1, quantity: 5, unitCost: '6.00', lineTotal: '30.00' }];
const multi = [...control, { product: 2, quantity: 3, unitCost: '2.07', lineTotal: '6.21' }];

function fixture(key = 'a') {
  assert.ok(['a', 'b'].includes(key));
  return {
    businessId: local.id('tenant-' + key),
    ownerId: local.id('owner-' + key),
    category: local.id('bf307-category-' + key),
    products: [1, 2].map((number) => ({
      id: local.id('bf307-product-' + key + '-' + number),
      movement: local.id('bf307-opening-' + key + '-' + number),
      name: 'BF307 Producto ' + key.toUpperCase() + number,
      opening: number === 1 ? 10 : 7,
      cost: number === 1 ? '4.03' : '1.19',
    })),
  };
}

function seed(users) {
  guard();
  for (const key of ['a', 'b']) {
    const f = fixture(key);
    assert.equal(users[key].businessId, f.businessId);
    assert.equal(users[key].userId, f.ownerId);
    const rows = f.products.map(
      (p) => `
      INSERT INTO public.products(id,business_id,name,sale_price,default_purchase_cost)
        VALUES('${p.id}','${f.businessId}','${p.name}',12.00,${p.cost});
      INSERT INTO public.stock_movements(id,business_id,product_id,type,quantity_delta,created_by,occurred_at)
        VALUES('${p.movement}','${f.businessId}','${p.id}','ADJUSTMENT',${p.opening},'${f.ownerId}','2026-01-01T00:00:00Z');`,
    );
    local.sql(`BEGIN;
      INSERT INTO public.expense_categories(id,business_id,name)
        VALUES('${f.category}','${f.businessId}','${categoryName}');
      ${rows.join('\n')}
      COMMIT;`);
    verifyBaseline(snapshot(key), key);
  }
}

function reset(users) {
  local.fullReset();
  verifyReset();
  local.seed(users);
  seed(users);
}

function verifyReset() {
  const counts = local.sql(`SELECT concat_ws(',',
    (SELECT count(*) FROM public.purchase_items),
    (SELECT count(*) FROM public.expenses),
    (SELECT count(*) FROM private.purchase_voids),
    (SELECT count(*) FROM public.products WHERE business_id IN ('${fixture().businessId}','${fixture('b').businessId}'))
  )`);
  assert.equal(counts, '0,0,0,0');
}

function snapshot(key = 'a') {
  const { businessId } = fixture(key);
  // Exact PostgreSQL decimal text, independent of how the UI formats the values.
  return JSON.parse(
    local.sql(`SELECT jsonb_build_object(
    'purchases',COALESCE((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('total',p.total::text) ORDER BY p.id) FROM public.purchases p WHERE p.business_id='${businessId}'),'[]'),
    'items',COALESCE((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('unit_cost_snapshot',i.unit_cost_snapshot::text,'line_total',i.line_total::text) ORDER BY i.id) FROM public.purchase_items i JOIN public.purchases p ON p.id=i.purchase_id WHERE p.business_id='${businessId}'),'[]'),
    'movements',COALESCE((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('unit_cost',m.unit_cost::text) ORDER BY m.id) FROM public.stock_movements m WHERE m.business_id='${businessId}'),'[]'),
    'expenses',COALESCE((SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object('amount',e.amount::text) ORDER BY e.id) FROM public.expenses e WHERE e.business_id='${businessId}'),'[]'),
    'corrections',COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM private.purchase_voids v WHERE v.business_id='${businessId}'),'[]'),
    'products',(SELECT jsonb_object_agg(p.id,jsonb_build_object('name',p.name,'cost',p.default_purchase_cost::text,'stock',(SELECT coalesce(sum(m.quantity_delta),0)::text FROM public.stock_movements m WHERE m.business_id=p.business_id AND m.product_id=p.id))) FROM public.products p WHERE p.business_id='${businessId}')
  )`),
  );
}

function verifyBaseline(actual, key = 'a') {
  const f = fixture(key);
  for (const name of ['purchases', 'items', 'expenses', 'corrections'])
    assert.deepEqual(actual[name], []);
  assert.equal(actual.movements.length, f.products.length);
  for (const p of f.products) {
    assert.deepEqual(actual.products[p.id], {
      name: p.name,
      cost: p.cost,
      stock: String(p.opening),
    });
    const movement = actual.movements.find((row) => row.id === p.movement);
    assert.equal(movement?.type, 'ADJUSTMENT');
    assert.equal(movement.product_id, p.id);
    assert.equal(movement.quantity_delta, p.opening);
  }
}

function verify(before, after, lines = control, total = '30.00') {
  const f = fixture();
  assert.equal(after.purchases.length, 1);
  const purchase = after.purchases[0];
  assert.equal(purchase.status, 'COMPLETED');
  assert.equal(purchase.business_id, f.businessId);
  assert.equal(purchase.created_by, f.ownerId);
  assert.equal(purchase.supplier, supplier);
  assert.equal(purchase.notes, notes);
  assert.equal(purchase.expense_category_id, f.category);
  assert.equal(purchase.payment_method, 'CASH');
  assert.equal(purchase.purchased_at, purchasedAt.replace('Z', '+00:00'));
  assert.equal(purchase.total, total);
  assert.match(purchase.operation_id, /^[\da-f-]{36}$/);
  assert.equal(after.items.length, lines.length);
  assert.equal(after.movements.length, before.movements.length + lines.length);
  assert.deepEqual(
    after.movements.filter((m) => before.movements.some((old) => old.id === m.id)),
    before.movements,
  );
  assert.equal(after.expenses.length, 1);
  assert.deepEqual(after.corrections, []);
  const expense = after.expenses[0];
  assert.equal(expense.purchase_id, purchase.id);
  assert.equal(expense.business_id, f.businessId);
  assert.equal(expense.created_by, f.ownerId);
  assert.equal(expense.source_type, 'PURCHASE');
  assert.equal(expense.amount, total);
  assert.equal(expense.category_id, f.category);
  assert.equal(expense.payment_method, 'CASH');
  assert.equal(expense.expense_date, expenseDate);
  assert.equal(expense.notes, notes);
  assert.equal(expense.receipt_path, null);
  assert.equal(expense.description, 'Compra de productos');
  assert.equal(
    cents(total),
    lines.reduce((sum, line) => sum + cents(line.lineTotal), 0n),
  );
  for (const [index, product] of f.products.entries()) {
    const line = lines.find((entry) => entry.product === index + 1);
    if (!line) {
      assert.deepEqual(after.products[product.id], before.products[product.id]);
      continue;
    }
    const item = after.items.find((row) => row.product_id === product.id);
    assert.equal(item?.purchase_id, purchase.id);
    assert.equal(item.product_name_snapshot, product.name);
    assert.equal(item.quantity, line.quantity);
    assert.equal(item.unit_cost_snapshot, line.unitCost);
    assert.equal(item.line_total, line.lineTotal);
    assert.equal(cents(item.line_total), cents(line.unitCost) * BigInt(line.quantity));
    const entries = after.movements.filter(
      (row) => row.product_id === product.id && row.reference_id === purchase.id,
    );
    assert.equal(entries.length, 1);
    const [movement] = entries;
    assert.equal(movement.type, 'PURCHASE');
    assert.equal(movement.reference_type, 'PURCHASE');
    assert.equal(movement.quantity_delta, line.quantity);
    assert.equal(movement.unit_cost, line.unitCost);
    assert.equal(movement.created_by, f.ownerId);
    assert.deepEqual(after.products[product.id], {
      name: product.name,
      cost: line.unitCost,
      stock: String(product.opening + line.quantity),
    });
  }
  return purchase;
}

function verifyVoid(before, after, operationId) {
  const [original] = before.purchases;
  assert.equal(after.purchases.length, 1);
  assert.deepEqual(after.purchases[0], {
    ...original,
    status: 'VOIDED',
    updated_at: after.purchases[0].updated_at,
  });
  assert.deepEqual(after.items, before.items);
  assert.deepEqual(after.expenses, before.expenses);
  assert.equal(after.corrections.length, 1);
  const [audit] = after.corrections;
  assert.equal(audit.operation_id, operationId);
  assert.equal(audit.reason, reason);
  assert.equal(audit.purchase_id, original.id);
  assert.equal(audit.business_id, original.business_id);
  assert.equal(audit.created_by, original.created_by);
  assert.ok(audit.created_at);
  const additions = after.movements.filter(
    (row) => !before.movements.some((old) => row.id === old.id),
  );
  assert.deepEqual(
    after.movements.filter((row) => !additions.includes(row)),
    before.movements,
  );
  assert.equal(additions.length, before.items.length);
  const expectedProducts = structuredClone(before.products);
  for (const item of before.items) {
    const movement = additions.find((row) => row.product_id === item.product_id);
    assert.equal(movement?.reference_type, 'PURCHASE_VOID');
    assert.equal(movement.reference_id, audit.id);
    assert.equal(movement.type, 'ADJUSTMENT');
    assert.equal(movement.quantity_delta, -item.quantity);
    assert.equal(movement.unit_cost, item.unit_cost_snapshot);
    assert.equal(movement.created_by, audit.created_by);
    const product = expectedProducts[item.product_id];
    product.stock = String(Number(product.stock) - item.quantity);
  }
  assert.deepEqual(after.products, expectedProducts);
}

function payload(key = 'a', operation = 'control') {
  const f = fixture(key);
  return {
    p_business_id: f.businessId,
    p_operation_id: local.id('bf307-purchase-' + operation),
    p_supplier: supplier,
    p_expense_category_id: f.category,
    p_payment_method: 'CASH',
    p_purchased_at: purchasedAt,
    p_notes: notes,
    p_items: [{ productId: f.products[0].id, quantity: 5, unitCost: '6.00' }],
  };
}

module.exports = {
  fixture,
  seed,
  reset,
  verifyReset,
  snapshot,
  verifyBaseline,
  verify,
  verifyVoid,
  payload,
  control,
  multi,
  supplier,
  categoryName,
  purchasedAt,
  expenseDate,
  notes,
  reason,
};
