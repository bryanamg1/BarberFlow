/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const sdk = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '../src/features/expenses');
function load(file, dependencies = {}) {
  const filename = path.resolve(root, file + '.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) => {
      if (name in dependencies) return dependencies[name];
      if (name === 'zod' || name === '@supabase/supabase-js') return require(name);
      assert(name.startsWith('.'), `Unexpected import ${name}`);
      return load(path.relative(root, path.resolve(path.dirname(filename), name)), dependencies);
    },
    module,
    module.exports,
  );
  return module.exports;
}
const input = {
  category_id: 'category',
  description: '  Original  ',
  amount: '10.50',
  payment_method: 'BANK_TRANSFER',
  expense_date: '2026-09-20',
  notes: null,
  receipt_path: '',
};
const at = '2026-09-20T00:00:00Z';
const row = {
  id: 'expense',
  business_id: 'business',
  category_id: 'category',
  source_type: 'MANUAL',
  purchase_id: null,
  description: input.description,
  amount: 10.5,
  payment_method: input.payment_method,
  expense_date: input.expense_date,
  notes: null,
  receipt_path: '',
  created_by: 'actor',
  created_at: at,
  updated_at: at,
};
const purchase = { ...row, source_type: 'PURCHASE', purchase_id: 'purchase' };
const columns =
  'id,business_id,category_id,source_type,purchase_id,description,amount,payment_method,expense_date,receipt_path,notes,created_by,created_at,updated_at';
const forged = {
  id: 'bad',
  business_id: 'foreign',
  source_type: 'PURCHASE',
  purchase_id: 'foreign',
  created_by: 'bad',
  created_at: 'bad',
  updated_at: 'bad',
  unknown: 'bad',
};
function harness(data = row, status = 200) {
  const requests = [];
  let identities = 0;
  const client = sdk.createClient('http://fixture.invalid', 'synthetic-public-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url, options) => {
        requests.push({ url: new URL(url), options });
        return new Response(JSON.stringify(data), { status });
      },
    },
  });
  client.auth.getUser = async () => {
    identities++;
    return { data: { user: { id: 'actor' } }, error: null };
  };
  const repo = load('repositories/expensesRepository', {
    '@/lib/supabase/client': { supabase: client },
  }).expensesRepository;
  return { repo, requests, client, identityCount: () => identities };
}
const response = (data = row, error = null, status = 200) => ({ data, error, status });
function service(result = response(), rejection) {
  const calls = [];
  const repo = Object.fromEntries(
    ['listByBusiness', 'getById', 'createManual', 'updateManual'].map((name) => [
      name,
      (...args) => {
        calls.push([name, ...args]);
        return rejection ? Promise.reject(rejection) : Promise.resolve(result);
      },
    ]),
  );
  return {
    calls,
    api: load('services/expensesService', {
      '../repositories/expensesRepository': { expensesRepository: repo },
    }).expensesService,
  };
}
test('exact four approved public operations, no delete or purchase writer', () => {
  const expected = ['createManual', 'getById', 'listByBusiness', 'updateManual'];
  assert.deepEqual(Object.keys(harness().repo).sort(), expected);
  assert.deepEqual(Object.keys(service().api).sort(), expected);
});
test('detail exact14 projection and tenant/id scope preserve PURCHASE linkage without active filters', async () => {
  const h = harness([purchase]);
  assert.deepEqual((await h.repo.getById('business', 'expense')).data, purchase);
  const q = h.requests[0].url;
  assert.equal(q.pathname, '/rest/v1/expenses');
  assert.deepEqual(Object.fromEntries(q.searchParams), {
    select: columns,
    business_id: 'eq.business',
    id: 'eq.expense',
  });
});
test('list server-side source/category/civil half-open bounds, descending tie-break and sentinel', async () => {
  const h = harness([]);
  await h.repo.listByBusiness('business', {
    page: 2,
    pageSize: 25,
    sourceType: 'PURCHASE',
    categoryId: 'old-category',
    from: '2026-09-01',
    to: '2026-10-01',
  });
  const q = h.requests[0].url;
  assert.equal(q.searchParams.get('select'), columns);
  assert.equal(q.searchParams.get('business_id'), 'eq.business');
  assert.equal(q.searchParams.get('source_type'), 'eq.PURCHASE');
  assert.equal(q.searchParams.get('category_id'), 'eq.old-category');
  assert.deepEqual(q.searchParams.getAll('expense_date'), ['gte.2026-09-01', 'lt.2026-10-01']);
  assert.equal(q.searchParams.get('order'), 'expense_date.desc,id.desc');
  assert.equal(q.searchParams.get('offset'), '25');
  assert.equal(q.searchParams.get('limit'), '26');
  assert.equal(h.requests[0].options.headers.get('Prefer'), null);
});
test('unfiltered list reads both histories, no parent status or category activity filter', async () => {
  const h = harness([row, purchase]);
  assert.deepEqual((await h.repo.listByBusiness('business', { page: 1, pageSize: 25 })).data, [
    row,
    purchase,
  ]);
  assert.deepEqual([...h.requests[0].url.searchParams.keys()].sort(), [
    'business_id',
    'limit',
    'offset',
    'order',
    'select',
  ]);
});
test('create derives identity once, strips forged fields, preserves decimal/civil/text/null without calculations', async () => {
  const h = harness();
  await h.repo.createManual('business', { ...input, ...forged });
  assert.equal(h.identityCount(), 1);
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), {
    ...input,
    business_id: 'business',
    source_type: 'MANUAL',
    purchase_id: null,
    created_by: 'actor',
  });
  assert.equal(request.url.searchParams.get('select'), columns);
});
test('manual update guards source/link on server and sends only defined seven fields', async () => {
  const h = harness([row]);
  await h.repo.updateManual('business', 'expense', {
    ...forged,
    amount: '0.29',
    notes: null,
    description: '',
    receipt_path: undefined,
  });
  const { options, url } = h.requests[0];
  assert.equal(options.method, 'PATCH');
  assert.deepEqual(JSON.parse(options.body), { amount: '0.29', notes: null, description: '' });
  assert.equal(url.searchParams.get('business_id'), 'eq.business');
  assert.equal(url.searchParams.get('id'), 'eq.expense');
  assert.equal(url.searchParams.get('source_type'), 'eq.MANUAL');
  assert.equal(url.searchParams.get('purchase_id'), 'is.null');
});
test('repository preserves actual SDK structured error/status; one request, no retry', async () => {
  const error = { code: '42501', message: 'private detail', details: 'private', hint: '' };
  const h = harness(error, 403);
  const result = await h.repo.getById('business', 'expense');
  assert.deepEqual(result.error, error);
  assert.equal(result.status, 403);
  assert.equal(h.requests.length, 1);
});
test('repository preserves Auth error response unchanged and never inserts without identity', async () => {
  const h = harness();
  const result = { data: { user: null }, error: new sdk.AuthSessionMissingError() };
  h.client.auth.getUser = async () => result;
  assert.equal(await h.repo.createManual('business', input), result);
  assert.equal(h.requests.length, 0);
});
test('repository preserves unexpected Auth rejection, no insert', async () => {
  const h = harness();
  const error = new Error('private');
  h.client.auth.getUser = async () => {
    throw error;
  };
  await assert.rejects(h.repo.createManual('business', input), (e) => e === error);
  assert.equal(h.requests.length, 0);
});
for (const method of ['getById', 'createManual', 'updateManual'])
  test(`service ${method} calls once and validates approved success row`, async () => {
    const h = service();
    const args =
      method === 'createManual'
        ? ['business', input]
        : method === 'updateManual'
          ? ['business', 'expense', { notes: null }]
          : ['business', 'expense'];
    assert.deepEqual(await h.api[method](...args), { data: row, error: null });
    assert.equal(h.calls.length, 1);
  });
test('service PURCHASE read remains historical; manual result cannot return a PURCHASE row', async () => {
  const h = service(response(purchase));
  assert.deepEqual((await h.api.getById('business', 'expense')).data, purchase);
  assert.equal(
    (await h.api.updateManual('business', 'expense', { notes: 'x' })).error.code,
    'UNKNOWN_ERROR',
  );
});
test('service pagination defaults, sentinel and empty successful result', async () => {
  const h = service(response(Array.from({ length: 26 }, (_, i) => ({ ...row, id: String(i) }))));
  const result = await h.api.listByBusiness('business');
  assert.equal(result.data.items.length, 25);
  assert.equal(result.data.hasNextPage, true);
  assert.deepEqual(h.calls[0], ['listByBusiness', 'business', { page: 1, pageSize: 25 }]);
  assert.deepEqual(await service(response([])).api.listByBusiness('business'), {
    data: { items: [], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
});
for (const params of [
  { page: 0 },
  { page: null },
  { pageSize: 101 },
  { page: Infinity },
  { page: Number.MAX_SAFE_INTEGER },
  { sourceType: 'OTHER' },
  { categoryId: ' ' },
  { from: '2026-02-30' },
  { to: '0000-01-01' },
  { from: '2026-10-01', to: '2026-09-01' },
])
  test(`invalid list boundary ${JSON.stringify(params)} prevents SDK call`, async () => {
    const h = service();
    assert.equal((await h.api.listByBusiness('business', params)).error.code, 'INVALID_INPUT');
    assert.equal(h.calls.length, 0);
  });
test('same civil-day half-open empty range preserved, category text never rewritten', async () => {
  const h = service(response([]));
  await h.api.listByBusiness('business', {
    from: '2026-09-20',
    to: '2026-09-20',
    categoryId: ' old ',
  });
  assert.deepEqual(h.calls[0][2], {
    page: 1,
    pageSize: 25,
    from: '2026-09-20',
    to: '2026-09-20',
    categoryId: ' old ',
  });
});
for (const patch of [
  { amount: '-1' },
  { amount: '1.001' },
  { amount: '10000000000' },
  { amount: 10 },
  { payment_method: 'TRANSFER' },
  { payment_method: 'DEBIT' },
  { payment_method: 'CREDIT' },
  { payment_method: 'OTHER' },
  { expense_date: '2026-02-29' },
  { expense_date: '0000-01-01' },
  { category_id: ' ' },
])
  test(`service reuses BF230 validation ${JSON.stringify(patch)}`, async () => {
    const h = service();
    assert.equal(
      (await h.api.createManual('business', { ...input, ...patch })).error.code,
      'INVALID_INPUT',
    );
    assert.equal(h.calls.length, 0);
  });
for (const amount of ['0', '0.00', '0.29', '10.50', '9999999999.99'])
  test(`service never coerces decimal input ${amount}`, async () => {
    const h = service();
    await h.api.createManual('business', { ...input, amount, ...forged });
    assert.deepEqual(h.calls[0], ['createManual', 'business', { ...input, amount }]);
  });
for (const payment_method of [
  'CASH',
  'BANK_TRANSFER',
  'DEBIT_CARD',
  'CREDIT_CARD',
  'DIGITAL_WALLET',
])
  test(`HD006 method ${payment_method} remains original`, async () => {
    const h = service();
    await h.api.createManual('business', { ...input, payment_method });
    assert.equal(h.calls[0][2].payment_method, payment_method);
  });
test('partial update null/empty preserved and empty or managed-only updates rejected', async () => {
  const h = service();
  await h.api.updateManual('business', 'expense', { notes: '', receipt_path: null, ...forged });
  assert.deepEqual(h.calls[0], [
    'updateManual',
    'business',
    'expense',
    { notes: '', receipt_path: null },
  ]);
  for (const patch of [{}, forged, { notes: undefined }])
    assert.equal(
      (await h.api.updateManual('business', 'expense', patch)).error.code,
      'INVALID_INPUT',
    );
  assert.equal(h.calls.length, 1);
});
for (const bad of [
  null,
  { ...row, business_id: 'foreign' },
  { ...row, id: 'other' },
  { ...row, amount: NaN },
  { ...row, amount: Infinity },
  { ...row, amount: '1.00' },
  { ...row, notes: undefined },
  { ...row, expense_date: 'bad' },
  { ...row, source_type: 'PURCHASE' },
  { ...row, created_at: 'bad' },
])
  test(`service fails closed on malformed/mis-scoped detail ${JSON.stringify(bad)}`, async () => {
    const result = await service(response(bad)).api.getById('business', 'expense');
    assert.equal(result.data, null);
    assert.equal(result.error.code, bad === null ? 'EXPENSE_NOT_FOUND' : 'UNKNOWN_ERROR');
  });
test('malformed or cross-tenant lists fail instead of partial/empty success', async () => {
  for (const data of [null, {}, [row, { ...row, business_id: 'foreign' }]])
    assert.equal(
      (await service(response(data)).api.listByBusiness('business')).error.code,
      'UNKNOWN_ERROR',
    );
});
for (const [error, status, code] of [
  [{ code: '42501' }, 403, 'EXPENSE_ACCESS_DENIED'],
  [{ code: '42501' }, 0, 'NETWORK_ERROR'],
  [{ code: 'x' }, 401, 'EXPENSE_ACCESS_DENIED'],
  [{ code: '23505' }, 409, 'UNKNOWN_ERROR'],
  [new sdk.AuthSessionMissingError(), undefined, 'EXPENSE_ACCESS_DENIED'],
  [new sdk.AuthRetryableFetchError('private', 503), undefined, 'NETWORK_ERROR'],
])
  test(`safe structural mapping ${status}/${code}`, async () => {
    const h = service(response(null, error, status));
    const result = await h.api.createManual('business', input);
    assert.equal(result.error.code, code);
    assert.deepEqual(Object.keys(result.error).sort(), ['code', 'message']);
    assert(!JSON.stringify(result).includes('private'));
    assert.equal(h.calls.length, 1);
  });
test('unexpected reject safely normalized without retry; missing Auth identity cannot fabricate success', async () => {
  const h = service(null, new Error('sensitive'));
  assert.equal((await h.api.getById('business', 'expense')).error.code, 'UNKNOWN_ERROR');
  assert.equal(h.calls.length, 1);
  assert.equal(
    (await service({ data: { user: null }, error: null }).api.createManual('business', input)).error
      .code,
    'UNKNOWN_ERROR',
  );
});
test('invalid tenant/id stops before repository, tenant strings are preserved', async () => {
  const h = service();
  assert.equal((await h.api.getById(' ', 'expense')).error.code, 'EXPENSE_ACCESS_DENIED');
  assert.equal((await h.api.getById('business', '')).error.code, 'INVALID_INPUT');
  assert.equal(h.calls.length, 0);
  await service(response({ ...row, business_id: ' business ' })).api.getById(
    ' business ',
    'expense',
  );
});
