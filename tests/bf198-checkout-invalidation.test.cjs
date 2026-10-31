const assert = require('node:assert/strict');
const { test } = require('node:test');
const { QueryClient, QueryObserver } = require('@tanstack/react-query');
const { load, id, b, input, data } = require('./helpers/bf196.cjs');
const dependencies = Object.fromEntries(
  ['appointments', 'clients', 'inventory', 'products', 'analytics'].map((feature) => [
    `@/features/${feature}/constants/${feature}Keys`,
    load(`../${feature}/constants/${feature}Keys`),
  ]),
);
const { invalidateCheckoutQueries } = load('utils/invalidateCheckoutQueries', dependencies);
const { salesKeys } = load('constants/salesKeys');
const { appointmentsKeys, clientsKeys, inventoryKeys, productsKeys } = Object.assign(
  {},
  ...Object.values(dependencies),
);
const scope = { businessId: b, userId: id(5), membershipId: id(9) };
const actor = { ...scope, role: 'OWNER' };
const capture = () => Object.freeze({ scope: Object.freeze({ ...scope }), input: input() });
const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const seed = (c, key) => {
  c.setQueryData(key, { fixture: true });
  return key;
};
const stale = (c, key) => c.getQueryState(key).isInvalidated;

test('BF198 exact persisted Sale detail and scoped list-prefix policy, other identities and details untouched', async () => {
  const c = client(),
    result = data();
  const own = seed(c, salesKeys.detail(actor, result.sale.id));
  // Synthetic cached list tests the existing feature/business/context convention;
  // no productive list query or BF198A contract is introduced here.
  const list = seed(c, ['sales', b, 'list', actor, { page: 1 }]);
  const untouched = [
    salesKeys.detail(actor, id(88)),
    salesKeys.detail({ ...actor, businessId: id(88) }, result.sale.id),
    salesKeys.detail({ ...actor, userId: id(88) }, result.sale.id),
    salesKeys.detail({ ...actor, membershipId: id(88) }, result.sale.id),
    salesKeys.detail({ ...actor, role: 'BARBER' }, result.sale.id),
    ['sales', b, 'detail', null, result.sale.id],
  ].map((key) => seed(c, key));
  await invalidateCheckoutQueries(c, capture(), result);
  assert(stale(c, own));
  assert(stale(c, list));
  untouched.forEach((key) => assert.equal(stale(c, key), false));
  c.clear();
});
test('BF198 appointment checkout targets related detail/list/availability in the captured OWNER context', async () => {
  const c = client(),
    result = data();
  result.sale.appointment_id = id(40);
  const keys = [
    appointmentsKeys.detail(actor, id(40)),
    appointmentsKeys.list(actor, { from: '2026-10-23T00:00:00Z', to: '2026-10-24T00:00:00Z' }),
    appointmentsKeys.availability(actor, null),
  ].map((key) => seed(c, key));
  const untouched = [
    appointmentsKeys.detail(actor, id(41)),
    appointmentsKeys.detail({ ...actor, userId: id(99) }, id(40)),
  ].map((key) => seed(c, key));
  await invalidateCheckoutQueries(c, capture(), result);
  keys.forEach((key) => assert(stale(c, key)));
  untouched.forEach((key) => assert.equal(stale(c, key), false));
  c.clear();
});
test('BF198 direct sale never invalidates appointments', async () => {
  const c = client(),
    key = seed(c, appointmentsKeys.list(actor, null));
  await invalidateCheckoutQueries(c, capture(), data());
  assert.equal(stale(c, key), false);
  c.clear();
});
test('BF198 unique affected products select detail/list, intersecting stock batch, movements and low-stock pages', async () => {
  const c = client(),
    saved = data(),
    intent = capture();
  const params = { page: 1, pageSize: 25, status: 'active' };
  const affected = [
    productsKeys.detail(scope, id(3)),
    productsKeys.list(scope, params),
    inventoryKeys.productStock(b, id(3)),
    inventoryKeys.productStockBatch(scope, [id(3), id(4)]),
    inventoryKeys.stockMovements(b, id(3), { page: 1, pageSize: 25 }),
    inventoryKeys.lowStockAlerts(scope, 1, 25),
  ].map((key) => seed(c, key));
  const untouched = [
    productsKeys.detail(scope, id(33)),
    productsKeys.list({ ...scope, userId: id(33) }, params),
    inventoryKeys.productStock(id(33), id(3)),
    inventoryKeys.productStockBatch(scope, [id(33)]),
    inventoryKeys.productStockBatch({ ...scope, membershipId: id(33) }, [id(3)]),
    inventoryKeys.lowStockAlerts({ ...scope, userId: id(33) }, 1, 25),
  ].map((key) => seed(c, key));
  await invalidateCheckoutQueries(c, intent, saved);
  affected.forEach((key) => assert(stale(c, key)));
  untouched.forEach((key) => assert.equal(stale(c, key), false));
  c.clear();
});
test('BF198 SERVICE-only does not touch product or inventory caches', async () => {
  const c = client(),
    saved = data(),
    intent = capture();
  intent.input.items = intent.input.items.filter((i) => i.itemType === 'SERVICE');
  saved.items = saved.items.filter((i) => i.item_type === 'SERVICE');
  const keys = [
    productsKeys.detail(scope, id(3)),
    inventoryKeys.productStock(b, id(3)),
    inventoryKeys.lowStockAlerts(scope, 1, 25),
  ].map((key) => seed(c, key));
  await invalidateCheckoutQueries(c, intent, saved);
  keys.forEach((key) => assert.equal(stale(c, key), false));
  c.clear();
});
test('BF198 duplicate and mixed PRODUCT lines schedule each resource once, preserving independent input lines', async () => {
  const intent = capture(),
    saved = data(),
    c = client();
  intent.input.items.push(
    { itemType: 'PRODUCT', itemId: id(3), quantity: 2 },
    { itemType: 'PRODUCT', itemId: id(30), quantity: 1 },
  );
  const a = seed(c, inventoryKeys.productStock(b, id(3))),
    other = seed(c, inventoryKeys.productStock(b, id(30)));
  const original = c.invalidateQueries.bind(c),
    calls = [];
  c.invalidateQueries = (filters) => {
    calls.push(filters);
    return original(filters);
  };
  await invalidateCheckoutQueries(c, intent, saved);
  assert(stale(c, a));
  assert(stale(c, other));
  assert.equal(calls.filter((x) => x.queryKey[0] === 'inventory').length, 1);
  assert.equal(calls.filter((x) => x.queryKey[0] === 'products').length, 1);
  assert.equal(intent.input.items.length, 4);
  c.clear();
});
test('BF198 replay invalidates persisted original products as well as captured references', async () => {
  const c = client(),
    saved = data();
  saved.sale.status = 'VOIDED';
  saved.items[1].product_id = id(31);
  const a = seed(c, inventoryKeys.productStock(b, id(3))),
    original = seed(c, inventoryKeys.productStock(b, id(31)));
  await invalidateCheckoutQueries(c, capture(), saved);
  assert(stale(c, a));
  assert(stale(c, original));
  c.clear();
});
test('BF198 only actual persisted client lifetime stats for captured actor/role are invalidated', async () => {
  const c = client(),
    saved = data();
  saved.sale.client_id = id(35);
  const own = seed(c, clientsKeys.stats(b, id(35), scope.userId, 'OWNER'));
  const others = [
    clientsKeys.stats(b, id(36), scope.userId, 'OWNER'),
    clientsKeys.stats(b, id(35), id(36), 'OWNER'),
    clientsKeys.stats(b, id(35), scope.userId, 'BARBER'),
    clientsKeys.detail(b, id(35)),
  ].map((key) => seed(c, key));
  await invalidateCheckoutQueries(c, capture(), saved);
  assert(stale(c, own));
  others.forEach((key) => assert.equal(stale(c, key), false));
  c.clear();
});
for (const mode of ['sync', 'async'])
  test(`BF198 ${mode} cache failures are isolated and all resource policies still execute`, async () => {
    const c = client(),
      calls = [];
    c.invalidateQueries = (filters) => {
      calls.push(filters.queryKey);
      if (mode === 'sync') throw new Error('private');
      return Promise.reject(new Error('private'));
    };
    await assert.doesNotReject(invalidateCheckoutQueries(c, capture(), data()));
    assert.equal(calls.length, 3);
    c.clear();
  });
test('BF198 navigation need not wait for active refetch; policy promise settles after scheduled refresh', async () => {
  const c = client(),
    key = salesKeys.detail(actor, id(4));
  let resolve;
  seed(c, key);
  const observer = new QueryObserver(c, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const unsubscribe = observer.subscribe(() => {});
  const maintenance = invalidateCheckoutQueries(c, capture(), data());
  assert.equal(typeof resolve, 'function');
  assert.equal(c.getQueryState(key).fetchStatus, 'fetching');
  resolve({ refreshed: true });
  await maintenance;
  assert.deepEqual(c.getQueryData(key), { refreshed: true });
  unsubscribe();
  c.clear();
});
for (const field of ['business_id', 'operation_id'])
  test(`BF198 mismatched ${field} cannot target any cache`, async () => {
    const c = client(),
      saved = data(),
      key = seed(c, salesKeys.detail(actor, id(4)));
    saved.sale[field] = id(90);
    await invalidateCheckoutQueries(c, capture(), saved);
    assert.equal(stale(c, key), false);
    c.clear();
  });
test('BF198 maintenance never clears caches or seeds privileged RPC rows; unrelated resources unchanged', async () => {
  const c = client(),
    key = seed(c, ['expenses', b]);
  await invalidateCheckoutQueries(c, capture(), data());
  assert.equal(stale(c, key), false);
  assert.equal(c.getQueryData(salesKeys.detail(actor, id(4))), undefined);
  assert.equal(c.getQueryCache().getAll().length, 1);
  c.clear();
});
