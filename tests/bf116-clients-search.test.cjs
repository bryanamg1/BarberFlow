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

const { normalizeClientSearchParams } = compile('utils/clientSearchParams.ts', (name) => {
  assert.equal(name, './clientListParams');
  return { normalizeClientListParams };
});
const { clientSearchFilter } = pure('repositories/clientSearchFilter.ts');
function loadHook(readBusiness, service, api) {
  const allowed = new Set(
    [
      'hooks/useClientSearch.ts',
      'hooks/clientHookUtils.ts',
      'constants/clientsKeys.ts',
      'utils/clientListParams.ts',
      'utils/clientErrors.ts',
      'utils/clientSearchParams.ts',
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
  const exports = load(path.join(clientsRoot, 'hooks/useClientSearch.ts'));
  assert.deepEqual(Object.keys(exports), ['useClientSearch']);
  return exports.useClientSearch;
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
  let params = { term: 'Sy' };
  let observer;
  let options;
  let unsubscribe;
  const hook = loadHook(
    () => business,
    {
      search: (...args) => {
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

function serviceHarness(operation) {
  const calls = [];
  const { clientsService } = compile('services/clientsService.ts', (name) => {
    if (name === '../utils/clientErrors') return { clientError };
    if (name === '../utils/clientListParams') return { normalizeClientListParams };
    if (name === '../utils/clientSearchParams') return { normalizeClientSearchParams };
    assert.equal(name, '../repositories/clientsRepository');
    return {
      clientsRepository: {
        searchByBusiness: (...args) => {
          calls.push(args);
          return operation(...args);
        },
      },
    };
  });
  return { service: clientsService, calls };
}

// Parse the documented quoted PostgREST value grammar independently of the encoder.
function parseFilter(filter) {
  let cursor = 0;
  const values = [];
  while (cursor < filter.length) {
    const field = /^(first_name|last_name|phone|email|instagram)\.imatch\./.exec(
      filter.slice(cursor),
    );
    assert.ok(field, 'Unexpected field/operator or injected structure');
    cursor += field[0].length;
    assert.equal(filter[cursor++], '"');
    let value = '';
    let closed = false;
    while (cursor < filter.length) {
      const char = filter[cursor++];
      if (char === '\\') {
        assert.ok(['\\', '"'].includes(filter[cursor]));
        value += filter[cursor++];
      } else if (char === '"') {
        closed = true;
        break;
      } else value += char;
    }
    assert.ok(closed);
    values.push([field[1], value]);
    if (cursor < filter.length) assert.equal(filter[cursor++], ',');
  }
  return values;
}
const terms = [
  'Sy',
  '%_',
  'a*b',
  'a,b',
  '(hi)',
  '"quote"',
  'a\\b',
  'x).or(business_id.neq.secret',
  '(?i)a.*[b]+$',
  '***=x',
  '50%_off',
  'A\nB',
  'MarTín',
  'x\\",y.eq.z',
];
for (const term of terms) {
  test(`BF-116: literal term survives quoted PostgREST grammar ${JSON.stringify(term)}`, () => {
    const parsed = parseFilter(clientSearchFilter(term));
    assert.deepEqual(
      parsed,
      ['first_name', 'last_name', 'phone', 'email', 'instagram'].map((field) => [
        field,
        `***=${term}`,
      ]),
    );
  });
}
for (const status of ['active', 'inactive', 'all']) {
  test(`BF-116: ${status} single SDK query preserves business, projection, literal OR, order and pageSize+1`, async () => {
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
    const params = { term: '%_*",)(\\', page: 3, pageSize: 100, status };
    const result = await repository(client).searchByBusiness(' business-A ', params);
    assert.deepEqual(result.data, rows);
    assert.equal(result.error, null);
    assert.equal(requests.length, 1);
    const { url, options } = requests[0];
    assert.equal(url.pathname, '/rest/v1/clients');
    assert.equal(options.method, 'GET');
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      select: columns,
      business_id: 'eq. business-A ',
      ...(status === 'all' ? {} : { is_active: `eq.${status === 'active'}` }),
      or: `(${clientSearchFilter(params.term)})`,
      order: 'first_name.asc,last_name.asc.nullslast,id.asc',
      offset: '200',
      limit: '101',
    });
    assert.equal(new Headers(options.headers).has('prefer'), false);
    assert.deepEqual(
      parseFilter(url.searchParams.get('or').slice(1, -1)).map((entry) => entry[1]),
      Array(5).fill(`***=${params.term}`),
    );
  });
}
test('BF-116: repository preserves raw SDK response/error and rejection identities', async () => {
  const raw = { data: null, error: { code: '42501', message: 'synthetic-private' }, status: 403 };
  for (const reject of [false, true]) {
    const chain = Object.fromEntries(
      ['select', 'eq', 'or', 'order', 'range', 'overrideTypes'].map((name) => [name, () => chain]),
    );
    chain.then = (resolve, onReject) =>
      (reject ? Promise.reject(raw) : Promise.resolve(raw)).then(resolve, onReject);
    const result = repository({ from: () => chain }).searchByBusiness('business', {
      ...defaults,
      term: 'Sy',
    });
    if (reject)
      await assert.rejects(
        async () => await result,
        (error) => error === raw,
      );
    else assert.equal(await result, raw);
  }
});

test('BF-116: service trims term, preserves case/internal whitespace and business, applies defaults', async () => {
  const h = serviceHarness(async () => ({ data: [], error: null, status: 200 }));
  assert.deepEqual(
    await h.service.search(' business ', { term: '  Sy  N  ' }),
    success(page(' business ', defaults, [])),
  );
  assert.deepEqual(h.calls, [[' business ', { ...defaults, term: 'Sy  N' }]]);
});
for (const term of ['', ' ', 'a', '\t a \n']) {
  test(`BF-116: short term ${JSON.stringify(term)} yields empty success without repository`, async () => {
    const h = serviceHarness(() => assert.fail('Short search reached repository'));
    assert.deepEqual(
      await h.service.search('business', { term, page: 2, pageSize: 10, status: 'all' }),
      success({ items: [], page: 2, pageSize: 10, hasNextPage: false }),
    );
    assert.deepEqual(h.calls, []);
  });
}
const invalidParams = [
  { page: 0 },
  { page: -1 },
  { page: 1.2 },
  { page: '1' },
  { page: NaN },
  { page: Infinity },
  { page: Number.MAX_VALUE },
  { pageSize: 0 },
  { pageSize: 101 },
  { pageSize: 2.5 },
  { pageSize: '25' },
  { pageSize: NaN },
  { status: 'ACTIVE' },
  { status: '' },
  { term: 42 },
  { term: null },
];
for (const input of invalidParams) {
  test(`BF-116: invalid search ${JSON.stringify(input)} does not call repository`, async () => {
    const h = serviceHarness(() => assert.fail('Invalid search reached repository'));
    assert.deepEqual(
      await h.service.search('business', { term: 'Sy', ...input }),
      failure('UNKNOWN_ERROR'),
    );
    assert.deepEqual(h.calls, []);
  });
}
for (const length of [0, 1, 2, 3]) {
  test(`BF-116: search page with ${length} rows slices sentinel and preserves ClientRow`, async () => {
    const rows = Object.freeze(Array.from({ length }, (_, i) => row('business', String(i))));
    const h = serviceHarness(async () => ({ data: rows, error: null, status: 200 }));
    const params = { term: 'Sy', page: 2, pageSize: 2, status: 'inactive' };
    const result = await h.service.search('business', params);
    assert.deepEqual(
      result,
      success({ items: rows.slice(0, 2), page: 2, pageSize: 2, hasNextPage: length > 2 }),
    );
    assert.deepEqual(h.calls, [['business', params]]);
    if (length > 0) assert.equal(result.data.items[0], rows[0]);
    assert.deepEqual(Object.keys(result.data).sort(), ['hasNextPage', 'items', 'page', 'pageSize']);
  });
}
for (const [status, code, expected] of [
  [0, '42501', 'NETWORK_ERROR'],
  [401, 'x', 'CLIENT_ACCESS_DENIED'],
  [403, 'x', 'CLIENT_ACCESS_DENIED'],
  [400, '42501', 'CLIENT_ACCESS_DENIED'],
  [500, 'x', 'UNKNOWN_ERROR'],
]) {
  test(`BF-116: safe error ${status}/${code}`, async () => {
    const h = serviceHarness(async () => ({
      data: [row()],
      error: { code, message: 'synthetic-private' },
      status,
    }));
    assert.deepEqual(await h.service.search('business', { term: 'Sy' }), failure(expected));
  });
}
test('BF-116: rejection and unexpected successful null map UNKNOWN_ERROR', async () => {
  for (const operation of [
    () => Promise.reject(new Error('synthetic-private')),
    async () => ({ data: null, error: null, status: 200 }),
  ])
    assert.deepEqual(
      await serviceHarness(operation).service.search('business', { term: 'Sy' }),
      failure('UNKNOWN_ERROR'),
    );
});

test('BF-116: exact key uses normalized term and four copied fields; all dimensions isolate', () => {
  const params = normalizeClientSearchParams({ term: '  Sy  ' });
  const key = clientsKeys.search(' business ', { ...params, userId: 'ignored', extra: undefined });
  assert.deepEqual(key, ['clients', ' business ', 'search', { term: 'Sy', ...defaults }]);
  assert.deepEqual(key.slice(0, 2), clientsKeys.byBusiness(' business '));
  const hash = query.hashKey(clientsKeys.search('A', params));
  for (const [id, patch] of [
    ['B', {}],
    ['A', { term: 'Other' }],
    ['A', { page: 2 }],
    ['A', { pageSize: 100 }],
    ['A', { status: 'all' }],
  ])
    assert.notEqual(query.hashKey(clientsKeys.search(id, { ...params, ...patch })), hash);
  assert.notEqual(query.hashKey(clientsKeys.list('A', defaults)), hash);
});
for (const business of [
  { status: 'idle' },
  { status: 'pending' },
  { status: 'error' },
  context(''),
  context(' \t'),
  context(null),
]) {
  test(`BF-116: context ${JSON.stringify(business)} disables search`, (t) => {
    const h = harness(t, business);
    assert.deepEqual(h.mount(), idle);
    assert.deepEqual(h.calls, []);
    assert.equal(h.options.enabled, false);
    assert.equal(h.options.queryFn, query.skipToken);
  });
}
for (const term of ['', ' ', 'a']) {
  test(`BF-116: hook short ${JSON.stringify(term)} idle even with cache`, (t) => {
    const h = harness(t);
    h.client.setQueryData(
      clientsKeys.search('business-A', { ...defaults, term: term.trim() }),
      page(),
    );
    h.render(undefined, { term });
    assert.deepEqual(h.mount(), idle);
    assert.deepEqual(h.calls, []);
    assert.equal(h.options.queryFn, query.skipToken);
  });
}
test('BF-116: hook invalid params mask cache and make no request', (t) => {
  const h = harness(t, context(), () => assert.fail('Invalid input reached service'));
  for (const input of invalidParams) {
    assert.deepEqual(h.render(context(), { term: 'Sy', ...input }), {
      status: 'error',
      ...failure('UNKNOWN_ERROR'),
      isFetching: false,
    });
    assert.equal(h.options.enabled, false);
    assert.equal(h.options.queryFn, query.skipToken);
  }
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.render({ status: 'idle' }, { term: 'Sy', page: 0 }), idle);
});
for (const role of ['OWNER', 'BARBER']) {
  test(`BF-116: ${role} normalized hook pending/success and inherited defaults`, async (t) => {
    const pending = deferred();
    const h = harness(t, context(' business ', role), () => pending.promise);
    h.render(undefined, { term: ' Sy ' });
    assert.deepEqual(h.mount(), { status: 'pending', data: null, error: null, isFetching: true });
    assert.deepEqual(h.calls, [[' business ', { ...defaults, term: 'Sy' }]]);
    assert.deepEqual(
      h.options.queryKey,
      clientsKeys.search(' business ', { ...defaults, term: 'Sy' }),
    );
    assert.deepEqual(Object.keys(h.options).sort(), ['enabled', 'queryFn', 'queryKey', 'retry']);
    assert.equal(h.options.retry, false);
    assert.equal(h.client.defaultQueryOptions(h.options).staleTime, 60000);
    const data = page(' business ', defaults, []);
    pending.resolve(success(data));
    assert.equal((await h.until((state) => state.status === 'success')).data, data);
  });
}
for (const code of ['NETWORK_ERROR', 'CLIENT_ACCESS_DENIED', 'UNKNOWN_ERROR']) {
  test(`BF-116: hook ${code} preserves safe error identity without retry`, async (t) => {
    const result = failure(code);
    const h = harness(t, context(), async () => result);
    h.mount();
    assert.equal((await h.until((state) => state.status === 'error')).error, result.error);
    assert.equal(h.calls.length, 1);
  });
}
for (const patch of [{ term: 'Other' }, { page: 2 }, { pageSize: 10 }, { status: 'inactive' }]) {
  test(`BF-116: changed params ${JSON.stringify(patch)} never show previous page`, async (t) => {
    const pending = deferred();
    let calls = 0;
    const h = harness(t, context(), () =>
      ++calls === 1 ? Promise.resolve(success(page())) : pending.promise,
    );
    h.mount();
    await h.until((state) => state.status === 'success');
    const params = { term: 'Sy', ...defaults, ...patch };
    assert.equal(h.render(undefined, params).data, null);
    const data = page('business-A', params);
    pending.resolve(success(data));
    assert.equal((await h.until((state) => state.status === 'success')).data, data);
    assert.equal(h.calls.length, 2);
  });
}
test('BF-116: late old-business/term result stays in its key; losing business/term masks data', async (t) => {
  const a = deferred(),
    b = deferred();
  const h = harness(t, context(), (id) => (id === 'business-A' ? a.promise : b.promise));
  h.mount();
  assert.equal(h.render(context('business-B'), { term: 'Other' }).data, null);
  const data = page('business-B');
  b.resolve(success(data));
  await h.until((state) => state.status === 'success');
  const late = new Promise((resolve) => {
    const off = h.client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[1] === 'business-A' && event.query.state.status === 'success') {
        off();
        resolve();
      }
    });
  });
  a.resolve(success(page()));
  await late;
  assert.equal(h.render().data, data);
  assert.deepEqual(h.render(context('business-B'), { term: 'a' }), idle);
  assert.deepEqual(h.render({ status: 'idle' }), idle);
});
test('BF-116: refresh error hides old data and scoped invalidation covers search', async (t) => {
  const pending = deferred();
  let calls = 0;
  const h = harness(t, context(), () =>
    ++calls === 1 ? Promise.resolve(success(page())) : pending.promise,
  );
  h.mount();
  await h.until((state) => state.status === 'success');
  const refresh = h.client.invalidateQueries({ queryKey: clientsKeys.byBusiness('business-A') });
  assert.equal(h.render().isFetching, true);
  const result = failure('NETWORK_ERROR');
  pending.resolve(result);
  await refresh;
  assert.deepEqual(h.render(), { status: 'error', ...result, isFetching: false });
});
test('BF-116: actual React/useQuery SSR renders cached search and idle short term', (t) => {
  const client = testClient();
  t.after(() => client.clear());
  const data = page();
  client.setQueryData(clientsKeys.search('business-A', { term: 'Sy', ...defaults }), data);
  const hook = loadHook(() => context(), { search: () => assert.fail('No SSR request') }, query);
  let term = ' Sy ';
  function Consumer() {
    const result = hook({ term });
    return React.createElement('span', null, result.status);
  }
  const render = () =>
    renderToStaticMarkup(
      React.createElement(query.QueryClientProvider, { client }, React.createElement(Consumer)),
    );
  assert.equal(render(), '<span>success</span>');
  term = 'a';
  assert.equal(render(), '<span>idle</span>');
});

test('BF-116: short term remains idle even if pagination is invalid', (t) => {
  const h = harness(t);
  assert.deepEqual(h.render(undefined, { term: ' a ', page: 0 }), idle);
  assert.equal(h.options.queryFn, query.skipToken);
  assert.deepEqual(h.calls, []);
});
test('BF-116: public TypeScript search API reuses page/result and excludes business/native options', () => {
  const filename = path.join(root, 'tests/__bf116_type_contract__.ts');
  const source = `
    import {useClientSearch,type UseClientSearchResult} from '@/features/clients/hooks/useClientSearch';
    import type {UseClientsResult} from '@/features/clients/hooks/useClients';
    import {clientsService} from '@/features/clients/services/clientsService';
    import {clientsKeys} from '@/features/clients/constants/clientsKeys';
    import {clientsRepository} from '@/features/clients/repositories/clientsRepository';
    import type {ClientListResult,ClientListStatus,ClientSearchParams} from '@/features/clients/types/client.types';
    type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true>=T;
    export type Hook=Assert<Equal<typeof useClientSearch,(params:ClientSearchParams)=>UseClientSearchResult>>;
    export type States=Assert<Equal<UseClientSearchResult,UseClientsResult>>;
    export type Service=Assert<Equal<typeof clientsService.search,(businessId:string,params:ClientSearchParams)=>Promise<ClientListResult>>>;
    export type Key=Assert<Equal<ReturnType<typeof clientsKeys.search>,readonly ['clients',string|null,'search',{readonly term:string;readonly page:number;readonly pageSize:number;readonly status:ClientListStatus}]>>;
    useClientSearch({term:'text'}); clientsService.search('business',{term:'Text',status:'all'});
    // @ts-expect-error Search params are required.
    useClientSearch();
    // @ts-expect-error Search term is required.
    useClientSearch({page:1});
    // @ts-expect-error Business comes from context.
    useClientSearch({term:'test',businessId:'business'});
    // @ts-expect-error No native refetch API.
    useClientSearch({term:'test'}).refetch();
    // @ts-expect-error No native retry option.
    useClientSearch({term:'test',retry:true});
    // @ts-expect-error Required normalized pagination at repository boundary.
    clientsRepository.searchByBusiness('business',{term:'test'});
    // @ts-expect-error No undefined pagination in key.
    clientsKeys.search(null,{term:'test'});
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options),
    original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) =>
    path.resolve(file) === filename
      ? ts.createSourceFile(file, source, options.target ?? ts.ScriptTarget.Latest, true)
      : original(file, ...args);
  const diagnostics = ts.getPreEmitDiagnostics(
    ts.createProgram(
      [filename, ...fileNames.filter((file) => file.endsWith('.d.ts'))],
      { ...options, noEmit: true },
      host,
    ),
  );
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
