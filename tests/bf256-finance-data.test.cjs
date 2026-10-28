/* global __dirname */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { test } = require('node:test'),
  ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '../src');
function load(file, overrides = {}, cache = new Map()) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) => {
      if (name in overrides) return overrides[name];
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/')
          ? path.join(root, name.slice(2))
          : path.resolve(path.dirname(filename), name);
        const f = ['.ts', '.tsx', '/index.ts'].map((e) => base + e).find(fs.existsSync);
        assert(f, name);
        return load(f, overrides, cache);
      }
      return require(name);
    },
    module,
    module.exports,
  );
  return module.exports;
}
const range = { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' };
const fixtures = {
  getDashboardSummary: {
    total_revenue: '100.00',
    service_revenue: '40.00',
    product_revenue: '60.00',
    expenses: '10.00',
    merchandise_purchases: '20.00',
    profit: '-0.50',
    appointments: '2',
    active_clients: '3',
    average_ticket: null,
    products_sold: '4',
    cancellations: '0',
    no_shows: '0',
  },
  getRevenueByDay: [
    {
      date: '2026-10-01',
      service_revenue: '40.00',
      product_revenue: '60.00',
      total_revenue: '100.00',
    },
  ],
  getExpenseSummary: {
    manual_total: '10.00',
    purchase_total: '20.00',
    total: '30.00',
    by_category: [{ category_id: null, amount: '30.00' }],
  },
  getTopServices: [
    {
      service_id: 's',
      name: '  Histórico  ',
      quantity: '900719925474099312345',
      net_revenue: '900719925474099312345.29',
    },
  ],
  getTopProducts: [
    {
      product_id: 'p',
      name: '  Histórico  ',
      quantity: '900719925474099312345',
      net_revenue: '900719925474099312345.29',
      cogs: '900719925474099312345.79',
      gross_profit: '-0.50',
    },
  ],
};
const names = {
  getDashboardSummary: 'get_dashboard_summary',
  getRevenueByDay: 'get_revenue_by_day',
  getExpenseSummary: 'get_expense_summary',
  getTopServices: 'get_top_services',
  getTopProducts: 'get_top_products',
};
function repository(fetch) {
  const client = createClient('https://finance-unit.example', 'test-only-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  return load('features/analytics/repositories/analyticsRepository.ts', {
    '@/lib/supabase/client': { supabase: client },
  }).analyticsRepository;
}
function service(method, response) {
  return load('features/analytics/services/analyticsService.ts', {
    '../repositories/analyticsRepository': { analyticsRepository: { [method]: () => response } },
  }).analyticsService;
}
for (const method of Object.keys(names)) {
  test(`BF256 repository ${method} exact RPC/args/signal and lossless transport`, async () => {
    const signal = new AbortController().signal;
    const repo = repository(async (url, init) => {
      const u = new URL(url);
      assert.equal(u.pathname, '/rest/v1/rpc/' + names[method]);
      const body = JSON.parse(init.body);
      assert.deepEqual(body, {
        p_business_id: 'business',
        p_from: range.from,
        p_to: range.to,
        ...(method.startsWith('getTop') ? { p_limit: 10 } : {}),
      });
      assert.equal(init.signal, signal);
      if (method.startsWith('getTop'))
        assert(u.searchParams.get('select').includes('quantity::text'));
      else assert.equal(u.searchParams.get('select'), null);
      return new Response(JSON.stringify(fixtures[method]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const result = method.startsWith('getTop')
      ? await repo[method]('business', range, 10, signal)
      : await repo[method]('business', range, signal);
    assert.deepEqual(result.data, fixtures[method]);
    assert.equal(result.error, null);
    assert.equal(result.status, 200);
  });
  test(`BF256 repository ${method} ALL_TIME null pair and SDK error passthrough`, async () => {
    const repo = repository(async (url, init) => {
      const args = JSON.parse(init.body);
      assert.equal(args.p_from, null);
      assert.equal(args.p_to, null);
      return new Response(
        JSON.stringify({
          code: '42501',
          message: 'private-db-error',
          details: 'private',
          hint: null,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const result = await repo[method]('business', { from: null, to: null });
    assert.equal(result.status, 403);
    assert.equal(result.error.code, '42501');
    assert.equal(result.error.message, 'private-db-error');
    assert.equal(result.data, null);
  });
  test(`BF256 service ${method} exact result/null/name/order/large signed values preserved`, async () => {
    const data = structuredClone(fixtures[method]);
    const s = service(method, Promise.resolve({ data, error: null, status: 200 }));
    const result = await s[method]('business', range);
    assert.deepEqual(result, { data, error: null });
  });
  test(`BF256 service ${method} malformed transport is safe INVALID_DATA`, async () => {
    for (const data of [null, {}, [null]]) {
      const s = service(method, Promise.resolve({ data, error: null, status: 200 }));
      const result = await s[method]('business', range);
      assert.equal(result.error.code, 'INVALID_DATA');
      assert.equal(result.data, null);
    }
  });
}
for (const [status, code, expected] of [
  [403, '42501', 'ACCESS_DENIED'],
  [401, 'x', 'ACCESS_DENIED'],
  [0, 'x', 'NETWORK_ERROR'],
  [400, '22023', 'INVALID_INPUT'],
  [500, 'P0001', 'UNKNOWN_ERROR'],
])
  test(`BF256 safe error ${status}/${code}`, async () => {
    const s = service(
      'getDashboardSummary',
      Promise.resolve({
        data: null,
        status,
        error: { code, message: 'secret SQL token private text' },
      }),
    );
    const result = await s.getDashboardSummary('b', range);
    assert.equal(result.error.code, expected);
    assert.doesNotMatch(JSON.stringify(result), /secret|SQL|token|private text/);
  });
test('BF256 service rejects unexpected rejection safely', async () => {
  const s = service('getDashboardSummary', Promise.reject(new Error('secret')));
  const result = await s.getDashboardSummary('b', range);
  assert.equal(result.error.code, 'UNKNOWN_ERROR');
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});
test('BF256 invalid business/range/limit never calls transport', async () => {
  let calls = 0;
  const s = service('getTopProducts', {
    then() {
      calls++;
      throw new Error('should not request');
    },
  });
  for (const [business, bounds, limit] of [
    ['', range, 10],
    ['b', { from: null, to: range.to }, 10],
    ['b', { from: range.to, to: range.from }, 10],
    ['b', range, 0],
    ['b', range, 101],
  ]) {
    const result = await s.getTopProducts(business, bounds, limit);
    assert(result.error);
  }
  assert.equal(calls, 0);
});
test('BF256 deterministic resource/business/range/timezone/limit/context keys', () => {
  const { analyticsKeys: k } = load('features/analytics/constants/analyticsKeys.ts');
  const scope = { userId: 'u', membershipId: 'm', businessId: 'b', timezone: 'UTC' };
  const key = k.resource('products', scope, range, 10);
  assert.deepEqual(k.resource('products', { ...scope }, { ...range }, 10), key);
  for (const other of [
    k.resource('services', scope, range, 10),
    k.resource('products', { ...scope, businessId: 'other' }, range, 10),
    k.resource('products', { ...scope, timezone: 'America/Argentina/Buenos_Aires' }, range, 10),
    k.resource('products', scope, { from: null, to: null }, 10),
    k.resource('products', scope, range, 11),
    k.resource('products', { ...scope, userId: 'other' }, range, 10),
  ])
    assert.notDeepEqual(key, other);
});
test('BF256 architecture has only five contracted RPCs and no UI Supabase/store/math ownership', () => {
  const repo = fs.readFileSync(
    path.join(root, 'features/analytics/repositories/analyticsRepository.ts'),
    'utf8',
  );
  assert.deepEqual(
    [...repo.matchAll(/\.rpc\('([^']+)'/g)].map((m) => m[1]).sort(),
    Object.values(names).sort(),
  );
  for (const f of ['screens/FinanceScreen.tsx', 'hooks/useFinanceQueries.ts']) {
    const s = fs.readFileSync(path.join(root, 'features/analytics', f), 'utf8');
    assert.doesNotMatch(s, /from ['"].*(?:supabase|zustand)|\.rpc\(|\.from\(/);
  }
  const route = fs.readFileSync(path.join(root, 'app/(app)/(tabs)/finances.tsx'), 'utf8');
  assert.match(route, /FinanceScreen as default/);
  assert.doesNotMatch(route, /useQuery|useState|supabase/);
});

for (const [method, field, bad] of [
  ['getDashboardSummary', 'profit', 'NaN'],
  ['getDashboardSummary', 'appointments', '1.5'],
  ['getTopProducts', 'quantity', 9007199254740992],
  ['getTopProducts', 'gross_profit', '1.001'],
  ['getTopServices', 'name', '  '],
  ['getTopServices', 'net_revenue', '-1.00'],
])
  test(`BF256 malformed ${method}.${field} rejected without coercion`, async () => {
    const data = structuredClone(fixtures[method]);
    (Array.isArray(data) ? data[0] : data)[field] = bad;
    const result = await service(method, Promise.resolve({ data, error: null, status: 200 }))[
      method
    ]('b', range);
    assert.equal(result.error.code, 'INVALID_DATA');
  });
test('BF256 service keeps multi-row producer order and zero expense success', async () => {
  const data = [
    fixtures.getTopServices[0],
    {
      ...fixtures.getTopServices[0],
      service_id: 'second',
      name: 'AAA',
      quantity: '0',
      net_revenue: '0.00',
    },
  ];
  const result = await service(
    'getTopServices',
    Promise.resolve({ data, error: null, status: 200 }),
  ).getTopServices('b', range);
  assert.deepEqual(result.data, data);
  const zero = { manual_total: '0.00', purchase_total: '0.00', total: '0.00', by_category: [] };
  assert.deepEqual(
    await service(
      'getExpenseSummary',
      Promise.resolve({ data: zero, error: null, status: 200 }),
    ).getExpenseSummary('b', { from: null, to: null }),
    { data: zero, error: null },
  );
});
