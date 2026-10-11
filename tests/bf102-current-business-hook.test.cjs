/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const query = require('@tanstack/react-query');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const hookFile = path.join(root, 'src/features/business/hooks/useCurrentBusiness.ts');
const idle = { status: 'idle', data: null, error: null, isFetching: false };
const authenticated = (id = 'synthetic-user-A') => ({ status: 'authenticated', user: { id } });
const current = (id = 'A', role = 'OWNER') => ({
  membershipId: `synthetic-membership-${id}`,
  role,
  business: {
    id: `synthetic-business-${id}`,
    name: `Business ${id}`,
    currency_code: 'ARS',
    timezone: 'America/Argentina/Buenos_Aires',
    is_active: true,
  },
});
const success = (data = current()) => ({ data, error: null });
const deferred = () => {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};

function compile(file, localRequire) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
    localRequire,
    module,
    module.exports,
  );
  return module.exports;
}

// Actual production defaults, isolated real client per test; no app singleton mutation.
function testClient() {
  return compile(path.join(root, 'src/lib/query/client.ts'), (name) => {
    assert.equal(name, '@tanstack/react-query');
    return query;
  }).queryClient;
}

function loadHook(useQuery, readAuth, operation) {
  const keys = compile(path.join(root, 'src/features/business/constants/businessKeys.ts'), () => {
    assert.fail('Query keys must not have runtime dependencies');
  });
  assert.deepEqual(Object.keys(keys.businessKeys), ['current']);
  const exports = compile(hookFile, (name) => {
    if (name === '@tanstack/react-query') return { skipToken: query.skipToken, useQuery };
    if (name === '@/features/auth/context/AuthContext') return { useAuth: readAuth };
    if (name === '../constants/businessKeys') return keys;
    if (name === '../services/currentBusinessService') {
      return { currentBusinessService: { getCurrentBusiness: operation } };
    }
    assert.fail(`Unexpected runtime dependency: ${name}`);
  });
  assert.deepEqual(Object.keys(exports), ['useCurrentBusiness']);
  assert.equal(exports.useCurrentBusiness.length, 0);
  return { ...exports, ...keys };
}

// Controlled hook scheduling over the real QueryObserver/cache. The SSR test below also
// exercises the actual useQuery hook and QueryClientProvider with real React.
function harness(t, initialAuth = authenticated(), operation = async () => success()) {
  const client = testClient();
  const calls = [];
  const listeners = new Set();
  let auth = initialAuth;
  let observer;
  let options;
  let unsubscribe;
  const { useCurrentBusiness, businessKeys } = loadHook(
    (received) => {
      options = received;
      const defaults = client.defaultQueryOptions(received);
      if (!observer) observer = new query.QueryObserver(client, defaults);
      else observer.setOptions(defaults);
      return observer.getOptimisticResult(defaults);
    },
    () => auth,
    (...args) => {
      calls.push(args);
      return operation(...args);
    },
  );
  function render(nextAuth) {
    if (nextAuth !== undefined) auth = nextAuth;
    const state = useCurrentBusiness();
    assert.deepEqual(Object.keys(state).sort(), ['data', 'error', 'isFetching', 'status']);
    return state;
  }
  function mount() {
    render();
    client.mount();
    unsubscribe = observer.subscribe(() => [...listeners].forEach((listener) => listener()));
    return render();
  }
  function until(predicate) {
    const state = render();
    if (predicate(state)) return Promise.resolve(state);
    return new Promise((resolve) => {
      const listener = () => {
        const state = render();
        if (predicate(state)) {
          listeners.delete(listener);
          resolve(state);
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
    businessKeys,
    get options() {
      return options;
    },
    get observer() {
      return observer;
    },
  };
}

for (const state of [
  { status: 'initializing', user: null },
  { status: 'recovering', user: { id: 'synthetic-recovery-user' } },
  { status: 'unauthenticated', user: null },
  { status: 'error', user: null, error: { code: 'UNKNOWN_ERROR', message: 'Error seguro' } },
]) {
  test(`BF-102: Auth ${state.status} is idle and never calls the service`, (t) => {
    const h = harness(t, state);
    assert.deepEqual(h.mount(), idle);
    assert.deepEqual(h.render(), idle);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.options.queryKey, ['business', 'current', null]);
    assert.equal(h.options.enabled, false);
    assert.equal(h.options.queryFn, query.skipToken);
  });
}

for (const id of ['', '   ', '\t\n', undefined, null, 42]) {
  test(`BF-102: invalid authenticated id ${JSON.stringify(id)} is disabled`, (t) => {
    const h = harness(t, { status: 'authenticated', user: { id } });
    assert.deepEqual(h.mount(), idle);
    assert.deepEqual(h.calls, []);
    assert.equal(h.options.enabled, false);
    assert.deepEqual(h.options.queryKey, ['business', 'current', null]);
  });
}

for (const role of ['OWNER', 'BARBER']) {
  test(`BF-102: pending then success preserves ${role}, full data and unmodified userId`, async (t) => {
    const pending = deferred();
    const h = harness(t, authenticated('  synthetic-original-id  '), () => pending.promise);
    assert.deepEqual(h.mount(), { status: 'pending', data: null, error: null, isFetching: true });
    assert.deepEqual(h.calls, [['  synthetic-original-id  ']]);
    assert.deepEqual(h.options.queryKey, ['business', 'current', '  synthetic-original-id  ']);
    const data = current('original', role);
    pending.resolve(success(data));
    const result = await h.until((state) => state.status === 'success');
    assert.deepEqual(result, { status: 'success', data, error: null, isFetching: false });
    assert.equal(result.data, data);
    assert.equal(result.data.business, data.business);
    assert.equal(h.options.enabled, true);
    assert.deepEqual(Object.keys(h.options).sort(), ['enabled', 'queryFn', 'queryKey', 'retry']);
    assert.equal(h.options.retry, false);
    const defaults = h.client.defaultQueryOptions(h.options);
    assert.equal(defaults.staleTime, 60_000);
    assert.equal(defaults.gcTime, 300_000);
    assert.equal(defaults.networkMode, 'online');
    assert.equal(defaults.refetchOnMount, true);
    assert.equal(defaults.refetchOnWindowFocus, true);
    assert.equal(defaults.refetchOnReconnect, true);
    assert.equal(h.client.getDefaultOptions().queries.retry, 2);
  });
}

const codes = [
  'NO_ACTIVE_MEMBERSHIP',
  'AMBIGUOUS_CURRENT_BUSINESS',
  'BUSINESS_NOT_RESOLVABLE',
  'BUSINESS_INACTIVE',
  'NETWORK_ERROR',
  'BUSINESS_ACCESS_DENIED',
  'UNKNOWN_ERROR',
];
for (const code of codes) {
  test(`BF-102: ${code} remains the same safe error with no automatic retry`, async (t) => {
    const error = { code, message: 'Mensaje seguro del service.' };
    const h = harness(t, authenticated(), async () => ({ data: null, error }));
    h.mount();
    const result = await h.until((state) => state.status === 'error');
    assert.deepEqual(result, { status: 'error', data: null, error, isFetching: false });
    assert.equal(result.error, error);
    assert.equal(h.observer.getCurrentResult().error, error);
    assert.equal(h.observer.getCurrentResult().failureCount, 1);
    assert.equal(h.options.retry, false);
    assert.deepEqual(h.calls, [['synthetic-user-A']]);
  });
}

test('BF-102: offline enabled query is pending without fetching and resumes online', async (t) => {
  query.onlineManager.setOnline(false);
  t.after(() => query.onlineManager.setOnline(true));
  const h = harness(t);
  assert.deepEqual(h.mount(), { status: 'pending', data: null, error: null, isFetching: false });
  assert.deepEqual(h.calls, []);
  assert.equal(h.observer.getCurrentResult().fetchStatus, 'paused');
  query.onlineManager.setOnline(true);
  await h.until((state) => state.status === 'success');
  assert.deepEqual(h.calls, [['synthetic-user-A']]);
});

test('BF-102: refresh retains success in flight but failure hides cached operational data', async (t) => {
  const pending = deferred();
  const error = {
    code: 'BUSINESS_ACCESS_DENIED',
    message: 'No tienes acceso al contexto del negocio.',
  };
  let reads = 0;
  const h = harness(t, authenticated(), () =>
    ++reads === 1 ? Promise.resolve(success()) : pending.promise,
  );
  h.mount();
  const first = await h.until((state) => state.status === 'success');
  const refresh = h.client.invalidateQueries({
    queryKey: h.businessKeys.current('synthetic-user-A'),
  });
  assert.deepEqual(h.render(), { ...first, isFetching: true });
  pending.resolve({ data: null, error });
  await refresh;
  assert.deepEqual(h.render(), { status: 'error', data: null, error, isFetching: false });
  assert.equal(h.client.getQueryData(h.businessKeys.current('synthetic-user-A')), first.data);
  assert.equal(reads, 2);
});

for (const status of ['unauthenticated', 'recovering']) {
  test(`BF-102: successful business is immediately hidden on ${status}`, async (t) => {
    const h = harness(t);
    h.mount();
    const first = await h.until((state) => state.status === 'success');
    // Even data at the disabled key cannot leak through the public adapter.
    h.client.setQueryData(h.businessKeys.current(null), first.data);
    assert.deepEqual(
      h.render({ status, user: status === 'recovering' ? { id: 'synthetic-user-A' } : null }),
      idle,
    );
    await h.client.invalidateQueries({ queryKey: ['business', 'current'] });
    assert.deepEqual(h.render(), idle);
    assert.equal(h.calls.length, 1);
    assert.equal(h.client.getQueryData(h.businessKeys.current('synthetic-user-A')), first.data);
  });
}

test('BF-102: A to B never exposes A as placeholder, including a late A response', async (t) => {
  const a = deferred();
  const b = deferred();
  const h = harness(t, authenticated('user-A'), (id) => (id === 'user-A' ? a.promise : b.promise));
  h.mount();
  assert.deepEqual(h.render(authenticated('user-B')), {
    status: 'pending',
    data: null,
    error: null,
    isFetching: true,
  });
  assert.deepEqual(h.calls, [['user-A'], ['user-B']]);
  assert.notDeepEqual(h.businessKeys.current('user-A'), h.businessKeys.current('user-B'));
  const bData = current('B', 'BARBER');
  b.resolve(success(bData));
  await h.until((state) => state.status === 'success');
  const finishedA = new Promise((resolve) => {
    const unsubscribe = h.client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[2] === 'user-A' && event.query.state.status === 'success') {
        unsubscribe();
        resolve();
      }
    });
  });
  a.resolve(success(current('A')));
  await finishedA;
  assert.equal(h.render().data, bData);
  assert.equal(
    h.client.getQueryData(h.businessKeys.current('user-A')).business.id,
    'synthetic-business-A',
  );
  assert.equal(h.client.getQueryData(h.businessKeys.current('user-B')), bData);
});

test('BF-102: cached A success is not exposed when switching to uncached B', async (t) => {
  const pending = deferred();
  const h = harness(t, authenticated('user-A'), () => pending.promise);
  h.client.setQueryData(h.businessKeys.current('user-A'), current('A'));
  assert.equal(h.mount().data.business.id, 'synthetic-business-A');
  assert.deepEqual(h.render(authenticated('user-B')), {
    status: 'pending',
    data: null,
    error: null,
    isFetching: true,
  });
  assert.deepEqual(h.calls, [['user-B']]);
  pending.resolve(success(current('B')));
  await h.until((state) => state.status === 'success');
});

test('BF-102: real React/useQuery/QueryClientProvider render cached success and disabled idle', (t) => {
  const client = testClient();
  t.after(() => client.clear());
  let auth = authenticated();
  const calls = [];
  const { useCurrentBusiness, businessKeys } = loadHook(
    query.useQuery,
    () => auth,
    (...args) => {
      calls.push(args);
      return Promise.resolve(success());
    },
  );
  const data = current();
  client.setQueryData(businessKeys.current(auth.user.id), data);
  function Consumer() {
    const result = useCurrentBusiness();
    if (result.status === 'success') assert.equal(result.data, data);
    else assert.deepEqual(result, idle);
    return React.createElement('span', null, result.status);
  }
  const render = () =>
    renderToStaticMarkup(
      React.createElement(query.QueryClientProvider, { client }, React.createElement(Consumer)),
    );
  assert.equal(render(), '<span>success</span>');
  auth = { status: 'recovering', user: { id: 'synthetic-user-A' } };
  assert.equal(render(), '<span>idle</span>');
  assert.deepEqual(calls, []);
});

test('BF-102: public TypeScript union and argument-free API match the approved contract', () => {
  const file = path.join(root, 'tests/__bf102_type_contract__.ts');
  const source = `
    import { useCurrentBusiness, type UseCurrentBusinessResult } from '@/features/business/hooks/useCurrentBusiness';
    import type { CurrentBusiness, CurrentBusinessServiceError } from '@/features/business/types/business.types';
    type Expected =
      | {status:'idle';data:null;error:null;isFetching:false}
      | {status:'pending';data:null;error:null;isFetching:boolean}
      | {status:'success';data:CurrentBusiness;error:null;isFetching:boolean}
      | {status:'error';data:null;error:CurrentBusinessServiceError;isFetching:boolean};
    type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true> = T;
    export type Result = Assert<Equal<UseCurrentBusinessResult,Expected>>;
    export type Operation = Assert<Equal<typeof useCurrentBusiness,()=>UseCurrentBusinessResult>>;
    // @ts-expect-error Hook accepts no arguments.
    useCurrentBusiness('user');
    // @ts-expect-error No manual refetch API.
    useCurrentBusiness().refetch();
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, ...args) =>
    path.resolve(name) === file
      ? ts.createSourceFile(name, source, options.target ?? ts.ScriptTarget.Latest, true)
      : original(name, ...args);
  const program = ts.createProgram(
    [file, ...fileNames.filter((name) => name.endsWith('.d.ts'))],
    { ...options, noEmit: true },
    host,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (name) => name,
      getNewLine: () => '\n',
    }),
  );
});
