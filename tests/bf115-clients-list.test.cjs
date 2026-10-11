/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const query = require('@tanstack/react-query');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '..');
const clientsRoot = path.join(root, 'src/features/clients');
const defaults = { page: 1, pageSize: 25, status: 'active' };
const idle = { status: 'idle', data: null, error: null, isFetching: false };
const messages = {
  NETWORK_ERROR: 'No se pudo conectar con el servicio. Inténtalo nuevamente.',
  CLIENT_ACCESS_DENIED: 'No se pudo acceder al cliente.',
  UNKNOWN_ERROR: 'No se pudo completar la operación del cliente. Inténtalo nuevamente.',
};
const failure = (code) => ({ data: null, error: { code, message: messages[code] } });
const row = (businessId = 'business-A', id = 'client-A') => ({
  id,
  business_id: businessId,
  first_name: ' Synthetic ',
  last_name: null,
  phone: null,
  email: '',
  instagram: null,
  birth_date: null,
  notes: ' ',
  preferences: null,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});
const page = (businessId = 'business-A', params = defaults, items = [row(businessId)]) => ({
  items,
  page: params.page,
  pageSize: params.pageSize,
  hasNextPage: false,
});
const success = (data) => ({ data, error: null });
const context = (id = 'business-A', role = 'OWNER') => ({
  status: 'success',
  data: { membershipId: 'membership', role, business: { id } },
  error: null,
  isFetching: false,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};

function compile(file, localRequire) {
  const filename = path.isAbsolute(file) ? file : path.join(clientsRoot, file);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    localRequire,
    module,
    module.exports,
  );
  return module.exports;
}
function pure(file) {
  return compile(file, (name) => assert.fail(`Unexpected pure dependency: ${name}`));
}
const { clientsKeys } = pure('constants/clientsKeys.ts');
const { normalizeClientListParams } = pure('utils/clientListParams.ts');
const { clientError } = pure('utils/clientErrors.ts');
const columns =
  'id,business_id,first_name,last_name,phone,email,instagram,birth_date,notes,preferences,is_active,created_at,updated_at';

function repository(client) {
  return compile('repositories/clientsRepository.ts', (name) => {
    if (name === './clientSearchFilter') return pure('repositories/clientSearchFilter.ts');
    assert.equal(name, '@/lib/supabase/client');
    return { supabase: client };
  }).clientsRepository;
}

for (const status of ['active', 'inactive', 'all']) {
  test(`BF-115: repository ${status} builds one ordered, scoped, explicitly projected range`, async () => {
    const calls = [];
    const result = { data: [row()], error: null, status: 200 };
    const chain = Object.fromEntries(
      ['select', 'eq', 'order', 'range', 'overrideTypes'].map((name) => [
        name,
        (...args) => {
          if (name !== 'overrideTypes') calls.push([name, ...args]);
          return chain;
        },
      ]),
    );
    chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
    const repo = repository({
      from: (...args) => {
        calls.push(['from', ...args]);
        return chain;
      },
    });
    const received = await repo.listByBusiness(' business-A ', { page: 3, pageSize: 25, status });
    assert.equal(received, result);
    assert.deepEqual(calls, [
      ['from', 'clients'],
      ['select', columns.replaceAll(',', ', ')],
      ['eq', 'business_id', ' business-A '],
      ...(status === 'all' ? [] : [['eq', 'is_active', status === 'active']]),
      ['order', 'first_name', { ascending: true }],
      ['order', 'last_name', { ascending: true, nullsFirst: false }],
      ['order', 'id', { ascending: true }],
      ['range', 50, 75],
    ]);
  });
}

test('BF-115: actual Supabase SDK emits one GET with nulls-last order and inclusive pageSize+1, no count/search/join', async () => {
  const requests = [];
  const rows = [row()];
  const client = createClient('https://synthetic.invalid', 'synthetic-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, options) => {
        requests.push({ url: new URL(url), options });
        return new Response(JSON.stringify(rows), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  const result = await repository(client).listByBusiness(' business-A ', {
    page: 2,
    pageSize: 100,
    status: 'all',
  });
  assert.deepEqual(result.data, rows);
  assert.equal(result.error, null);
  assert.equal(requests.length, 1);
  const { url, options } = requests[0];
  assert.equal(url.pathname, '/rest/v1/clients');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    select: columns,
    business_id: 'eq. business-A ',
    order: 'first_name.asc,last_name.asc.nullslast,id.asc',
    offset: '100',
    limit: '101',
  });
  assert.equal(options.method, 'GET');
  assert.equal(new Headers(options.headers).has('prefer'), false);
});

test('BF-115: repository preserves SDK error/result identity and unexpected rejection', async () => {
  const raw = { data: null, error: { code: '42501', message: 'synthetic-private' }, status: 403 };
  for (const reject of [false, true]) {
    const chain = Object.fromEntries(
      ['select', 'eq', 'order', 'range', 'overrideTypes'].map((name) => [name, () => chain]),
    );
    chain.then = (resolve, onReject) =>
      (reject ? Promise.reject(raw) : Promise.resolve(raw)).then(resolve, onReject);
    const promise = repository({ from: () => chain }).listByBusiness('business', defaults);
    if (reject)
      await assert.rejects(
        async () => await promise,
        (error) => error === raw,
      );
    else assert.equal(await promise, raw);
  }
});

function serviceHarness(operation) {
  const calls = [];
  const { clientsService } = compile('services/clientsService.ts', (name) => {
    if (name === '../utils/clientSearchParams')
      return compile('utils/clientSearchParams.ts', (dependency) => {
        assert.equal(dependency, './clientListParams');
        return { normalizeClientListParams };
      });
    if (name === '../utils/clientErrors') return { clientError };
    if (name === '../utils/clientListParams') return { normalizeClientListParams };
    assert.equal(name, '../repositories/clientsRepository');
    return {
      clientsRepository: {
        listByBusiness: (...args) => {
          calls.push(args);
          return operation(...args);
        },
      },
    };
  });
  return { service: clientsService, calls };
}

for (const params of [undefined, {}, { page: 1 }, { pageSize: 25 }, { status: 'active' }]) {
  test(`BF-115: service fills defaults without coercion for ${JSON.stringify(params)}`, async () => {
    const h = serviceHarness(async () => ({ data: [], error: null, status: 200 }));
    const result = await h.service.list(' business-A ', params);
    assert.deepEqual(h.calls, [[' business-A ', defaults]]);
    assert.deepEqual(result, success(page(' business-A ', defaults, [])));
  });
}

for (const status of ['active', 'inactive', 'all']) {
  test(`BF-115: service preserves explicit ${status} params and row identity, trims only extra row`, async () => {
    const rows = Object.freeze([row(), row('business-A', 'B'), row('business-A', 'extra')]);
    const params = Object.freeze({ page: 3, pageSize: 2, status });
    const h = serviceHarness(async () => ({ data: rows, error: null, status: 200 }));
    const result = await h.service.list('business-A', params);
    assert.deepEqual(h.calls, [['business-A', params]]);
    assert.deepEqual(
      result,
      success({ items: rows.slice(0, 2), page: 3, pageSize: 2, hasNextPage: true }),
    );
    assert.equal(result.data.items[0], rows[0]);
    assert.equal(result.data.items[1], rows[1]);
    assert.equal(rows.length, 3);
    assert.deepEqual(Object.keys(result.data).sort(), ['hasNextPage', 'items', 'page', 'pageSize']);
  });
}

for (const length of [0, 1, 2]) {
  test(`BF-115: ${length} rows <= pageSize is success with hasNextPage false`, async () => {
    const rows = Array.from({ length }, (_, i) => row('business-A', String(i)));
    const h = serviceHarness(async () => ({ data: rows, error: null, status: 200 }));
    assert.deepEqual(
      await h.service.list('business-A', { pageSize: 2 }),
      success({ items: rows, page: 1, pageSize: 2, hasNextPage: false }),
    );
  });
}

const invalidParams = [
  { page: 0 },
  { page: -1 },
  { page: 1.5 },
  { page: '1' },
  { page: NaN },
  { page: Infinity },
  { pageSize: 0 },
  { pageSize: -1 },
  { pageSize: 1.5 },
  { pageSize: '25' },
  { pageSize: NaN },
  { pageSize: Infinity },
  { pageSize: 101 },
  { status: 'ACTIVE' },
  { status: '' },
  { status: false },
  { page: Number.MAX_VALUE },
  { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
];
for (const params of invalidParams) {
  test(`BF-115: invalid params ${JSON.stringify(params)} never call repository`, async () => {
    const h = serviceHarness(() => assert.fail('Invalid params reached repository'));
    assert.deepEqual(await h.service.list('business-A', params), failure('UNKNOWN_ERROR'));
    assert.deepEqual(h.calls, []);
  });
}

test('BF-115: pageSize min/max and exact safe range boundary are accepted, nullish fields use approved defaults', async () => {
  for (const params of [
    { pageSize: 1 },
    { pageSize: 100 },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 1 },
    { page: null, pageSize: null, status: null },
  ]) {
    const h = serviceHarness(async () => ({ data: [], error: null, status: 200 }));
    const result = await h.service.list('business', params);
    assert.equal(result.error, null);
    assert.equal(h.calls.length, 1);
  }
});

for (const [status, code, expected] of [
  [0, '42501', 'NETWORK_ERROR'],
  [401, 'other', 'CLIENT_ACCESS_DENIED'],
  [403, 'other', 'CLIENT_ACCESS_DENIED'],
  [400, '42501', 'CLIENT_ACCESS_DENIED'],
  [500, 'other', 'UNKNOWN_ERROR'],
]) {
  test(`BF-115: list normalizes status ${status}, code ${code} without raw error leakage`, async () => {
    const h = serviceHarness(async () => ({
      data: [row()],
      error: { code, message: 'synthetic-private', details: 'synthetic-private' },
      status,
    }));
    assert.deepEqual(await h.service.list('business'), failure(expected));
  });
}
test('BF-115: unexpected null/rejection/synchronous throw remain UNKNOWN_ERROR, never empty success', async () => {
  for (const operation of [
    async () => ({ data: null, error: null, status: 200 }),
    () => Promise.reject(new Error('synthetic-private')),
    () => {
      throw new Error('synthetic-private');
    },
  ]) {
    assert.deepEqual(
      await serviceHarness(operation).service.list('business'),
      failure('UNKNOWN_ERROR'),
    );
  }
});

test('BF-115: list key exact shape and hierarchy; only normalized page/pageSize/status copied', () => {
  const params = { ...defaults, userId: 'ignored', searchTerm: 'ignored', extra: undefined };
  const key = clientsKeys.list(' business-A ', params);
  assert.deepEqual(key, ['clients', ' business-A ', 'list', defaults]);
  assert.deepEqual(key.slice(0, 2), clientsKeys.byBusiness(' business-A '));
  assert.notEqual(key[3], params);
  assert.deepEqual(clientsKeys.list(null, defaults), ['clients', null, 'list', defaults]);
});
for (const [business, params] of [
  ['B', defaults],
  ['A', { ...defaults, page: 2 }],
  ['A', { ...defaults, pageSize: 100 }],
  ['A', { ...defaults, status: 'inactive' }],
  ['A', { ...defaults, status: 'all' }],
]) {
  test(`BF-115: cache key isolates ${business}/${JSON.stringify(params)}`, () => {
    assert.notEqual(
      query.hashKey(clientsKeys.list('A', defaults)),
      query.hashKey(clientsKeys.list(business, params)),
    );
  });
}

function loadHook(readBusiness, service, api) {
  const allowed = new Set(
    [
      'hooks/useClients.ts',
      'hooks/clientHookUtils.ts',
      'constants/clientsKeys.ts',
      'utils/clientListParams.ts',
      'utils/clientErrors.ts',
    ].map((file) => path.join(clientsRoot, file)),
  );
  const cache = new Map();
  function load(filename) {
    assert.ok(allowed.has(filename), `Unexpected module: ${filename}`);
    if (!cache.has(filename))
      cache.set(
        filename,
        compile(filename, (name) => {
          if (name === '@tanstack/react-query') return api;
          if (name === '@/features/business/context/BusinessContext')
            return { useBusiness: readBusiness };
          if (name === '../services/clientsService') return { clientsService: service };
          assert.ok(name.startsWith('.'), `Unexpected dependency: ${name}`);
          return load(path.resolve(path.dirname(filename), `${name}.ts`));
        }),
      );
    return cache.get(filename);
  }
  const exports = load(path.join(clientsRoot, 'hooks/useClients.ts'));
  assert.deepEqual(Object.keys(exports), ['useClients']);
  return exports.useClients;
}
function testClient() {
  return compile(path.join(root, 'src/lib/query/client.ts'), (name) => {
    assert.equal(name, '@tanstack/react-query');
    return query;
  }).queryClient;
}
function harness(
  t,
  initialBusiness = context(),
  operation = async (id, params) => success(page(id, params)),
) {
  const client = testClient();
  const calls = [];
  const listeners = new Set();
  let business = initialBusiness;
  let params;
  let observer;
  let options;
  let unsubscribe;
  const hook = loadHook(
    () => business,
    {
      list: (...args) => {
        calls.push(args);
        return operation(...args);
      },
    },
    {
      ...query,
      useQuery: (received) => {
        options = received;
        const effective = client.defaultQueryOptions(received);
        if (!observer) observer = new query.QueryObserver(client, effective);
        else observer.setOptions(effective);
        return observer.getOptimisticResult(effective);
      },
    },
  );
  function render(nextBusiness, nextParams) {
    if (nextBusiness !== undefined) business = nextBusiness;
    if (nextParams !== undefined) params = nextParams;
    const result = hook(params);
    assert.deepEqual(Object.keys(result).sort(), ['data', 'error', 'isFetching', 'status']);
    return result;
  }
  function mount() {
    render();
    client.mount();
    unsubscribe = observer.subscribe(() => [...listeners].forEach((listener) => listener()));
    return render();
  }
  function until(predicate) {
    const result = render();
    if (predicate(result)) return Promise.resolve(result);
    return new Promise((resolve) => {
      const listener = () => {
        const next = render();
        if (predicate(next)) {
          listeners.delete(listener);
          resolve(next);
        }
      };
      listeners.add(listener);
    });
  }
  t.after(() => {
    listeners.clear();
    unsubscribe?.();
    observer?.destroy();
    client.unmount();
    client.clear();
  });
  return {
    client,
    calls,
    render,
    mount,
    until,
    get options() {
      return options;
    },
    get observer() {
      return observer;
    },
  };
}

for (const business of [
  { status: 'idle' },
  { status: 'pending' },
  { status: 'error' },
  context(''),
  context(' \t\n'),
  context(null),
  { ...context(), data: { ...context().data, business: { id: undefined } } },
]) {
  test(`BF-115: unavailable business ${JSON.stringify(business)} remains idle with zero service calls`, (t) => {
    const h = harness(t, business);
    assert.deepEqual(h.mount(), idle);
    assert.deepEqual(h.calls, []);
    assert.equal(h.options.enabled, false);
    assert.equal(h.options.queryFn, query.skipToken);
  });
}

for (const role of ['OWNER', 'BARBER']) {
  test(`BF-115: ${role} hook preserves original business, pending/success and inherited cache defaults`, async (t) => {
    const pending = deferred();
    const data = page(' business-A ');
    const h = harness(t, context(' business-A ', role), () => pending.promise);
    assert.deepEqual(h.mount(), { status: 'pending', data: null, error: null, isFetching: true });
    assert.deepEqual(h.calls, [[' business-A ', defaults]]);
    assert.deepEqual(h.options.queryKey, clientsKeys.list(' business-A ', defaults));
    assert.deepEqual(Object.keys(h.options).sort(), ['enabled', 'queryFn', 'queryKey', 'retry']);
    assert.equal(h.options.retry, false);
    const effective = h.client.defaultQueryOptions(h.options);
    assert.equal(effective.staleTime, 60_000);
    assert.equal(effective.gcTime, 300_000);
    for (const name of ['refetchOnMount', 'refetchOnWindowFocus', 'refetchOnReconnect'])
      assert.equal(effective[name], true);
    pending.resolve(success(data));
    assert.deepEqual(await h.until((state) => state.status === 'success'), {
      status: 'success',
      data,
      error: null,
      isFetching: false,
    });
  });
}

test('BF-115: hook accepts empty success and explicit pagination/status', async (t) => {
  const params = { page: 4, pageSize: 100, status: 'all' };
  const data = page('business-A', params, []);
  const h = harness(t, context(), async () => success(data));
  h.render(undefined, params);
  h.mount();
  assert.equal((await h.until((state) => state.status === 'success')).data, data);
  assert.deepEqual(h.calls, [['business-A', params]]);
  assert.deepEqual(h.options.queryKey, clientsKeys.list('business-A', params));
});
test('BF-115: invalid hook params mask cached success, disable query, and never call service', (t) => {
  const h = harness(t, context(), () => assert.fail('Invalid params reached service'));
  h.client.setQueryData(clientsKeys.list('business-A', defaults), page());
  for (const params of invalidParams) {
    const result = h.render(context(), params);
    assert.deepEqual(result, { status: 'error', ...failure('UNKNOWN_ERROR'), isFetching: false });
    assert.equal(h.options.queryFn, query.skipToken);
    assert.equal(h.options.enabled, false);
    assert.deepEqual(h.options.queryKey, clientsKeys.list('business-A', defaults));
  }
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.render({ status: 'idle' }, { page: 0 }), idle);
});

for (const code of ['NETWORK_ERROR', 'CLIENT_ACCESS_DENIED', 'UNKNOWN_ERROR']) {
  test(`BF-115: hook preserves ${code} identity and does not retry`, async (t) => {
    const result = failure(code);
    const h = harness(t, context(), async () => result);
    h.mount();
    const received = await h.until((state) => state.status === 'error');
    assert.equal(received.error, result.error);
    assert.equal(received.data, null);
    assert.equal(h.calls.length, 1);
    assert.equal(h.observer.getCurrentResult().failureCount, 1);
  });
}

for (const nextParams of [
  { ...defaults, page: 2 },
  { ...defaults, status: 'inactive' },
  { ...defaults, pageSize: 10 },
]) {
  test(`BF-115: page/status/size transition ${JSON.stringify(nextParams)} never reuses previous data`, async (t) => {
    const next = deferred();
    let reads = 0;
    const h = harness(t, context(), () =>
      ++reads === 1 ? Promise.resolve(success(page())) : next.promise,
    );
    h.mount();
    await h.until((state) => state.status === 'success');
    const changed = h.render(undefined, nextParams);
    assert.equal(changed.status, 'pending');
    assert.equal(changed.data, null);
    assert.deepEqual(h.options.queryKey, clientsKeys.list('business-A', nextParams));
    const data = page('business-A', nextParams);
    next.resolve(success(data));
    assert.equal((await h.until((state) => state.status === 'success')).data, data);
    assert.equal(h.calls.length, 2);
  });
}
test('BF-115: business transition isolates keys and late responses; business loss masks cache', async (t) => {
  const a = deferred();
  const b = deferred();
  const h = harness(t, context(), (id) => (id === 'business-A' ? a.promise : b.promise));
  h.mount();
  assert.equal(h.render(context('business-B')).data, null);
  const data = page('business-B');
  b.resolve(success(data));
  await h.until((state) => state.status === 'success');
  const lateA = new Promise((resolve) => {
    const unsubscribe = h.client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[1] === 'business-A' && event.query.state.status === 'success') {
        unsubscribe();
        resolve();
      }
    });
  });
  a.resolve(success(page()));
  await lateA;
  assert.equal(h.render().data, data);
  for (const status of ['idle', 'pending', 'error']) assert.deepEqual(h.render({ status }), idle);
  assert.equal(h.calls.length, 2);
});
test('BF-115: refetch error masks previous page and scoped BF-114 invalidation reaches lists only for the business', async (t) => {
  const next = deferred();
  let reads = 0;
  const h = harness(t, context(), () =>
    ++reads === 1 ? Promise.resolve(success(page())) : next.promise,
  );
  h.client.setQueryData(clientsKeys.list('business-B', defaults), page('business-B'));
  h.mount();
  const first = await h.until((state) => state.status === 'success');
  const refresh = h.client.invalidateQueries({ queryKey: clientsKeys.byBusiness('business-A') });
  assert.deepEqual(h.render(), { ...first, isFetching: true });
  const result = failure('NETWORK_ERROR');
  next.resolve(result);
  await refresh;
  assert.deepEqual(h.render(), { status: 'error', ...result, isFetching: false });
  assert.equal(
    h.client.getQueryState(clientsKeys.list('business-B', defaults)).isInvalidated,
    false,
  );
  assert.equal(reads, 2);
});

test('BF-115: real React/useQuery SSR adapter reads correct cache and masks unavailable business', (t) => {
  const client = testClient();
  t.after(() => client.clear());
  let business = context();
  const data = page();
  client.setQueryData(clientsKeys.list('business-A', defaults), data);
  const hook = loadHook(
    () => business,
    { list: () => assert.fail('SSR must not request data') },
    query,
  );
  function Consumer() {
    const state = hook();
    if (business.status === 'success') assert.equal(state.data, data);
    else assert.deepEqual(state, idle);
    return React.createElement('span', null, state.status);
  }
  const render = () =>
    renderToStaticMarkup(
      React.createElement(query.QueryClientProvider, { client }, React.createElement(Consumer)),
    );
  assert.equal(render(), '<span>success</span>');
  business = { status: 'idle' };
  assert.equal(render(), '<span>idle</span>');
});

test('BF-115: public TypeScript contract is paginated ClientRow, four hook states, no search/UI/native API', () => {
  const filename = path.join(root, 'tests/__bf115_type_contract__.ts');
  const source = `
    import { useClients, type UseClientsResult } from '@/features/clients/hooks/useClients';
    import { clientsKeys } from '@/features/clients/constants/clientsKeys';
    import { clientsService } from '@/features/clients/services/clientsService';
    import { clientsRepository, type ClientRow } from '@/features/clients/repositories/clientsRepository';
    import type { ClientListParams, ClientListPage, ClientListResult, ClientListStatus, ClientServiceError } from '@/features/clients/types/client.types';
    type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true> = T;
    export type Params = Assert<Equal<ClientListParams,{page?:number;pageSize?:number;status?:ClientListStatus}>>;
    export type Status = Assert<Equal<ClientListStatus,'active'|'inactive'|'all'>>;
    export type Page = Assert<Equal<ClientListPage,{items:ClientRow[];page:number;pageSize:number;hasNextPage:boolean}>>;
    export type Result = Assert<Equal<ClientListResult,{data:ClientListPage;error:null}|{data:null;error:ClientServiceError}>>;
    export type Service = Assert<Equal<typeof clientsService.list,(businessId:string,params?:ClientListParams)=>Promise<ClientListResult>>>;
    export type Hook = Assert<Equal<typeof useClients,(params?:ClientListParams)=>UseClientsResult>>;
    export type HookResult = Assert<Equal<UseClientsResult,
      |{status:'idle';data:null;error:null;isFetching:false}
      |{status:'pending';data:null;error:null;isFetching:boolean}
      |{status:'success';data:ClientListPage;error:null;isFetching:boolean}
      |{status:'error';data:null;error:ClientServiceError;isFetching:boolean}>>;
    export type Key = Assert<Equal<ReturnType<typeof clientsKeys.list>,readonly ['clients',string|null,'list',{readonly page:number;readonly pageSize:number;readonly status:ClientListStatus}]>>;
    useClients(); useClients({page:2,pageSize:100,status:'all'});
    clientsKeys.list(null,{page:1,pageSize:25,status:'active'});
    // @ts-expect-error No business argument.
    useClients('business');
    // @ts-expect-error No search.
    useClients({searchTerm:'name'});
    // @ts-expect-error No native options.
    useClients({retry:true});
    // @ts-expect-error No manual refetch API.
    useClients().refetch();
    // @ts-expect-error Invalid status.
    clientsService.list('business',{status:'archived'});
    // @ts-expect-error Repository requires normalized params.
    clientsRepository.listByBusiness('business',{page:1});
    // @ts-expect-error Key requires normalized params.
    clientsKeys.list('business',{});
    // @ts-expect-error List tuple readonly.
    clientsKeys.list(null,{page:1,pageSize:25,status:'all'})[1]='other';
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) =>
    path.resolve(file) === filename
      ? ts.createSourceFile(file, source, options.target ?? ts.ScriptTarget.Latest, true)
      : original(file, ...args);
  const program = ts.createProgram(
    [filename, ...fileNames.filter((file) => file.endsWith('.d.ts'))],
    { ...options, noEmit: true },
    host,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (file) => file,
      getNewLine: () => '\n',
    }),
  );
});
