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
const clientsRoot = path.join(root, 'src/features/clients');
const idle = { status: 'idle', data: null, error: null, isFetching: false };
const context = (id = 'business-A', role = 'OWNER') => ({
  status: 'success',
  data: { membershipId: 'membership', role, business: { id } },
  error: null,
  isFetching: false,
});
const row = (businessId = 'business-A', id = 'client-A') => ({
  id,
  business_id: businessId,
  first_name: ' Synthetic ',
  last_name: null,
  phone: null,
  email: null,
  instagram: null,
  birth_date: null,
  notes: '',
  preferences: null,
  is_active: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});
const success = (data = row()) => ({ data, error: null });
const deferred = () => {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};
const denied = {
  code: 'CLIENT_ACCESS_DENIED',
  message: 'No hay un negocio disponible para realizar esta operación.',
};
const notFound = {
  code: 'CLIENT_NOT_FOUND',
  message: 'No se encontró el cliente o no está disponible.',
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

function testClient() {
  return compile(path.join(root, 'src/lib/query/client.ts'), (name) => {
    assert.equal(name, '@tanstack/react-query');
    return query;
  }).queryClient;
}

function loadHooks(readBusiness, service, queryApi) {
  const cache = new Map();
  const allowed = new Set(
    [
      'constants/clientsKeys.ts',
      'hooks/clientHookUtils.ts',
      'hooks/useClientDetail.ts',
      'hooks/useCreateClient.ts',
      'hooks/useUpdateClient.ts',
    ].map((file) => path.join(clientsRoot, file)),
  );
  function load(file) {
    assert.ok(allowed.has(file), `Unexpected runtime module: ${file}`);
    if (!cache.has(file)) {
      cache.set(
        file,
        compile(file, (name) => {
          if (name === '@tanstack/react-query') return queryApi;
          if (name === '@/features/business/context/BusinessContext')
            return { useBusiness: readBusiness };
          if (name === '../services/clientsService') return { clientsService: service };
          assert.ok(name.startsWith('.'), `Unexpected runtime dependency: ${name}`);
          return load(path.resolve(path.dirname(file), `${name}.ts`));
        }),
      );
    }
    return cache.get(file);
  }
  const exports = {};
  for (const name of ['useClientDetail', 'useCreateClient', 'useUpdateClient']) {
    const hook = load(path.join(clientsRoot, `hooks/${name}.ts`));
    assert.deepEqual(Object.keys(hook), [name]);
    Object.assign(exports, hook);
  }
  return exports;
}

// Production adapters and real QueryClient/observers. Scheduling is controlled here;
// the React SSR test below also exercises the actual three TanStack React hooks.
function harness(
  t,
  kind = 'detail',
  initialBusiness = context(),
  operation = async () => success(),
) {
  const client = testClient();
  const calls = [];
  const invalidations = [];
  const listeners = new Set();
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = (filters) => {
    invalidations.push(filters);
    return invalidate(filters);
  };
  let business = initialBusiness;
  let clientId = 'client-A';
  let observer;
  let options;
  let unsubscribe;
  const notify = () => [...listeners].forEach((listener) => listener());
  const useQuery = (received) => {
    assert.equal(kind, 'detail');
    options = received;
    const defaults = client.defaultQueryOptions(received);
    if (!observer) observer = new query.QueryObserver(client, defaults);
    else observer.setOptions(defaults);
    return observer.getOptimisticResult(defaults);
  };
  const useMutation = (received) => {
    assert.notEqual(kind, 'detail');
    options = received;
    if (!observer) observer = new query.MutationObserver(client, received);
    else observer.setOptions(received);
    const result = observer.getCurrentResult();
    return { ...result, mutateAsync: result.mutate };
  };
  const service = Object.fromEntries(
    ['getById', 'create', 'update'].map((name) => [
      name,
      (...args) => {
        assert.equal(name, { detail: 'getById', create: 'create', update: 'update' }[kind]);
        calls.push(args);
        return operation(...args);
      },
    ]),
  );
  const hooks = loadHooks(() => business, service, {
    ...query,
    useQuery,
    useMutation,
    useQueryClient: () => client,
  });
  const hook =
    hooks[
      { detail: 'useClientDetail', create: 'useCreateClient', update: 'useUpdateClient' }[kind]
    ];
  function render(nextBusiness, nextClientId) {
    if (nextBusiness !== undefined) business = nextBusiness;
    if (nextClientId !== undefined) clientId = nextClientId;
    const result = kind === 'detail' ? hook(clientId) : hook();
    assert.deepEqual(
      Object.keys(result).sort(),
      kind === 'detail'
        ? ['data', 'error', 'isFetching', 'status']
        : ['data', 'error', 'mutateAsync', 'reset', 'status'],
    );
    return result;
  }
  function mount() {
    render();
    client.mount();
    unsubscribe = observer.subscribe(notify);
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
    if (kind === 'detail') observer?.destroy();
    else observer?.reset();
    client.unmount();
    client.clear();
  });
  return {
    client,
    calls,
    invalidations,
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
  test(`BF-114: detail unavailable business ${JSON.stringify(business)} stays idle`, (t) => {
    const h = harness(t, 'detail', business);
    assert.deepEqual(h.mount(), idle);
    assert.deepEqual(h.calls, []);
    assert.equal(h.options.enabled, false);
    assert.equal(h.options.queryFn, query.skipToken);
    assert.deepEqual(h.options.queryKey, ['clients', null, 'detail', 'client-A']);
  });
}

for (const clientId of [null, '', ' \t\n']) {
  test(`BF-114: invalid detail clientId ${JSON.stringify(clientId)} stays idle even with disabled cache`, (t) => {
    const h = harness(t);
    h.client.setQueryData(['clients', 'business-A', 'detail', null], row());
    h.render(undefined, clientId);
    assert.deepEqual(h.mount(), idle);
    assert.equal(h.options.queryFn, query.skipToken);
    assert.equal(h.options.enabled, false);
    assert.deepEqual(h.options.queryKey, ['clients', 'business-A', 'detail', null]);
    assert.deepEqual(h.calls, []);
  });
}

for (const role of ['OWNER', 'BARBER']) {
  test(`BF-114: detail preserves original IDs, inactive row and defaults for ${role}`, async (t) => {
    const pending = deferred();
    const data = row(' business-A ', ' client-A ');
    const h = harness(t, 'detail', context(' business-A ', role), () => pending.promise);
    h.render(undefined, ' client-A ');
    assert.deepEqual(h.mount(), { status: 'pending', data: null, error: null, isFetching: true });
    assert.deepEqual(h.calls, [[' business-A ', ' client-A ']]);
    assert.deepEqual(h.options.queryKey, ['clients', ' business-A ', 'detail', ' client-A ']);
    assert.equal(h.options.enabled, true);
    assert.equal(h.options.retry, false);
    assert.deepEqual(Object.keys(h.options).sort(), ['enabled', 'queryFn', 'queryKey', 'retry']);
    const defaults = h.client.defaultQueryOptions(h.options);
    assert.equal(defaults.staleTime, 60_000);
    assert.equal(defaults.gcTime, 300_000);
    for (const option of ['refetchOnMount', 'refetchOnWindowFocus', 'refetchOnReconnect'])
      assert.equal(defaults[option], true);
    assert.equal(defaults.networkMode, 'online');
    pending.resolve(success(data));
    const result = await h.until((state) => state.status === 'success');
    assert.equal(result.data, data);
    assert.equal(result.data.is_active, false);
    assert.equal(result.error, null);
    assert.equal(result.isFetching, false);
  });
}

const codes = ['CLIENT_NOT_FOUND', 'NETWORK_ERROR', 'CLIENT_ACCESS_DENIED', 'UNKNOWN_ERROR'];
for (const code of codes) {
  test(`BF-114: detail preserves ${code} by identity without retry`, async (t) => {
    const error = { code, message: 'Mensaje seguro del service.' };
    const h = harness(t, 'detail', context(), async () => ({ data: null, error }));
    h.mount();
    const result = await h.until((state) => state.status === 'error');
    assert.equal(result.error, error);
    assert.equal(result.data, null);
    assert.equal(h.calls.length, 1);
    assert.equal(h.observer.getCurrentResult().failureCount, 1);
  });
}

test('BF-114: detail refresh keeps valid data while fetching, then hides it on failure', async (t) => {
  const pending = deferred();
  const error = { code: 'NETWORK_ERROR', message: 'Mensaje seguro.' };
  let reads = 0;
  const h = harness(t, 'detail', context(), () =>
    ++reads === 1 ? Promise.resolve(success()) : pending.promise,
  );
  h.mount();
  const first = await h.until((state) => state.status === 'success');
  const refresh = h.client.invalidateQueries({ queryKey: ['clients', 'business-A'] });
  assert.deepEqual(h.render(), { ...first, isFetching: true });
  pending.resolve({ data: null, error });
  await refresh;
  assert.deepEqual(h.render(), { status: 'error', data: null, error, isFetching: false });
  assert.equal(h.client.getQueryData(['clients', 'business-A', 'detail', 'client-A']), first.data);
  assert.equal(reads, 2);
});

test('BF-114: detail switches A to B without placeholder or late A leakage, and hides on business loss', async (t) => {
  const a = deferred();
  const b = deferred();
  const h = harness(t, 'detail', context(), (id) => (id === 'business-A' ? a.promise : b.promise));
  h.mount();
  assert.equal(h.render(context('business-B')).status, 'pending');
  const dataB = row('business-B');
  b.resolve(success(dataB));
  await h.until((state) => state.status === 'success');
  const lateA = new Promise((resolve) => {
    const unsubscribe = h.client.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[1] === 'business-A' && event.query.state.status === 'success') {
        unsubscribe();
        resolve();
      }
    });
  });
  a.resolve(success());
  await lateA;
  assert.equal(h.render().data, dataB);
  assert.deepEqual(h.options.queryKey, ['clients', 'business-B', 'detail', 'client-A']);
  for (const status of ['idle', 'pending', 'error']) assert.deepEqual(h.render({ status }), idle);
  assert.equal(h.calls.length, 2);
});

const createInput = { first_name: ' Original ', last_name: null, phone: '', notes: '  ' };
const updateInput = { first_name: ' Original ', is_active: false, preferences: null };
const payload = (kind, clientId = ' client-A ') =>
  kind === 'create' ? createInput : { clientId, input: updateInput };
const assertMutationIdle = (result) => {
  assert.equal(result.status, 'idle');
  assert.equal(result.data, null);
  assert.equal(result.error, null);
};

for (const kind of ['create', 'update']) {
  for (const role of ['OWNER', 'BARBER']) {
    test(`BF-114: ${kind} ${role} preserves inputs/result, uses scoped invalidation and reset`, async (t) => {
      const data = row(' business-A ', ' client-A ');
      const started = deferred();
      const pending = deferred();
      const h = harness(t, kind, context(' business-A ', role), (...args) => {
        started.resolve(args);
        return pending.promise;
      });
      h.client.setQueryData(['clients', ' business-A ', 'detail', ' client-A '], row());
      h.client.setQueryData(['clients', 'business-B', 'detail', 'client-A'], row('business-B'));
      h.client.setQueryData(['business', 'current', 'user'], {});
      assertMutationIdle(h.mount());
      const promise = h.render().mutateAsync(payload(kind));
      await started.promise;
      const inFlight = h.render();
      assert.equal(inFlight.status, 'pending');
      assert.equal(inFlight.data, null);
      assert.equal(inFlight.error, null);
      assert.equal(h.observer.getCurrentResult().variables.businessId, ' business-A ');
      assert.equal(
        h.observer.getCurrentResult().variables.input,
        kind === 'create' ? createInput : updateInput,
      );
      assert.deepEqual(h.calls, [
        kind === 'create'
          ? [' business-A ', createInput]
          : [' business-A ', ' client-A ', updateInput],
      ]);
      assert.equal(h.calls[0].at(-1), kind === 'create' ? createInput : updateInput);
      assert.equal(h.options.retry, false);
      assert.deepEqual(Object.keys(h.options).sort(), ['mutationFn', 'onSuccess', 'retry']);
      pending.resolve(success(data));
      assert.equal(await promise, data);
      const result = h.render();
      assert.equal(result.status, 'success');
      assert.equal(result.data, data);
      assert.equal(result.error, null);
      assert.deepEqual(h.invalidations, [{ queryKey: ['clients', ' business-A '] }]);
      assert.equal(
        h.client.getQueryState(['clients', ' business-A ', 'detail', ' client-A ']).isInvalidated,
        true,
      );
      assert.equal(
        h.client.getQueryState(['clients', 'business-B', 'detail', 'client-A']).isInvalidated,
        false,
      );
      assert.equal(h.client.getQueryState(['business', 'current', 'user']).isInvalidated, false);
      // Invalidation must not replace the cached detail with the returned mutation row.
      assert.notEqual(
        h.client.getQueryData(['clients', ' business-A ', 'detail', ' client-A ']),
        data,
      );
      result.reset();
      assertMutationIdle(h.render());
      assert.equal(h.invalidations.length, 1);
    });
  }

  for (const code of codes) {
    test(`BF-114: ${kind} preserves ${code} rejection and error state without retry/invalidation`, async (t) => {
      const error = { code, message: 'Mensaje seguro del service.' };
      const h = harness(t, kind, context(), async () => ({ data: null, error }));
      h.mount();
      await assert.rejects(h.render().mutateAsync(payload(kind)), (received) => received === error);
      const result = h.render();
      assert.equal(result.status, 'error');
      assert.equal(result.error, error);
      assert.equal(result.data, null);
      assert.equal(h.calls.length, 1);
      assert.equal(h.observer.getCurrentResult().failureCount, 1);
      assert.deepEqual(h.invalidations, []);
      result.reset();
      assertMutationIdle(h.render());
    });
  }

  test(`BF-114: ${kind} unavailable business rejects inside mutation lifecycle with approved error`, async (t) => {
    const h = harness(t, kind);
    h.mount();
    for (const business of [
      { status: 'idle' },
      { status: 'pending' },
      { status: 'error' },
      context(''),
      context('  '),
    ]) {
      h.render(business).reset();
      await assert.rejects(h.render().mutateAsync(payload(kind)), (error) => {
        assert.deepEqual(error, denied);
        return true;
      });
      const result = h.render();
      assert.equal(result.status, 'error');
      assert.deepEqual(result.error, denied);
      assert.equal(result.data, null);
      assert.equal(h.observer.getCurrentResult().status, 'error');
    }
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.invalidations, []);
  });

  for (const outcome of ['success', 'error']) {
    test(`BF-114: ${kind} late A ${outcome} remains scoped after switching to B and during a B mutation`, async (t) => {
      const a = deferred();
      const b = deferred();
      const started = deferred();
      const error = { code: 'NETWORK_ERROR', message: 'Mensaje seguro.' };
      const h = harness(t, kind, context(), (id) => {
        if (id === 'business-A') started.resolve();
        return id === 'business-A' ? a.promise : b.promise;
      });
      h.mount();
      // Catch immediately to avoid unhandled rejections while coordinating both requests.
      const promiseA = h
        .render()
        .mutateAsync(payload(kind))
        .then(
          (data) => ({ data }),
          (error) => ({ error }),
        );
      await started.promise;
      assertMutationIdle(h.render(context('business-B')));
      const promiseB = h.render().mutateAsync(payload(kind));
      assert.equal(h.render().status, 'pending');
      a.resolve(outcome === 'success' ? success() : { data: null, error });
      const completedA = await promiseA;
      if (outcome === 'success') assert.equal(completedA.data.business_id, 'business-A');
      else assert.equal(completedA.error, error);
      const current = h.render();
      assert.equal(current.status, 'pending');
      assert.equal(current.data, null);
      assert.equal(current.error, null);
      assert.deepEqual(
        h.invalidations,
        outcome === 'success' ? [{ queryKey: ['clients', 'business-A'] }] : [],
      );
      const dataB = row('business-B');
      b.resolve(success(dataB));
      assert.equal(await promiseB, dataB);
      assert.equal(h.render().data, dataB);
      assert.deepEqual(h.invalidations.at(-1), { queryKey: ['clients', 'business-B'] });
    });
  }

  test(`BF-114: ${kind} late A result is hidden in B before B has any mutation, and on business loss`, async (t) => {
    const pending = deferred();
    const started = deferred();
    const h = harness(t, kind, context(), () => {
      started.resolve();
      return pending.promise;
    });
    h.mount();
    const promise = h.render().mutateAsync(payload(kind));
    await started.promise;
    assertMutationIdle(h.render(context('business-B')));
    pending.resolve(success());
    await promise;
    assertMutationIdle(h.render());
    assert.equal(h.render(context()).status, 'success');
    for (const status of ['idle', 'pending', 'error']) assertMutationIdle(h.render({ status }));
    assert.deepEqual(h.invalidations, [{ queryKey: ['clients', 'business-A'] }]);
  });
}

for (const clientId of ['', ' \t\n', null, undefined]) {
  test(`BF-114: update invalid clientId ${JSON.stringify(clientId)} uses mutation error lifecycle`, async (t) => {
    const h = harness(t, 'update');
    h.mount();
    await assert.rejects(h.render().mutateAsync({ clientId, input: updateInput }), (error) => {
      assert.deepEqual(error, notFound);
      return true;
    });
    assert.equal(h.render().status, 'error');
    assert.deepEqual(h.render().error, notFound);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(h.invalidations, []);
  });
}

test('BF-114: real React/useQuery/useMutation render exact cached detail and initial mutation adapters', (t) => {
  const client = testClient();
  t.after(() => client.clear());
  let business = context();
  const data = row();
  client.setQueryData(['clients', 'business-A', 'detail', 'client-A'], data);
  const service = new Proxy({}, { get: () => () => assert.fail('SSR must not execute service') });
  const hooks = loadHooks(() => business, service, query);
  function Consumer() {
    const detail = hooks.useClientDetail('client-A');
    if (business.status === 'success') assert.equal(detail.data, data);
    else assert.deepEqual(detail, idle);
    assertMutationIdle(hooks.useCreateClient());
    assertMutationIdle(hooks.useUpdateClient());
    return React.createElement('span', null, detail.status);
  }
  const render = () =>
    renderToStaticMarkup(
      React.createElement(query.QueryClientProvider, { client }, React.createElement(Consumer)),
    );
  assert.equal(render(), '<span>success</span>');
  business = { status: 'idle' };
  assert.equal(render(), '<span>idle</span>');
});

test('BF-114: public TypeScript APIs exclude tenant IDs, callbacks, native options and invalid states', () => {
  const file = path.join(root, 'tests/__bf114_type_contract__.ts');
  const source = `
    import { useClientDetail, type UseClientDetailResult } from '@/features/clients/hooks/useClientDetail';
    import { useCreateClient, type ClientMutationResult, type ClientMutationStatus } from '@/features/clients/hooks/useCreateClient';
    import { useUpdateClient, type UpdateClientVariables } from '@/features/clients/hooks/useUpdateClient';
    import type { CreateClientInput, UpdateClientInput } from '@/features/clients/schemas/client.schema';
    import type { ClientRow } from '@/features/clients/repositories/clientsRepository';
    import type { ClientServiceError } from '@/features/clients/types/client.types';
    type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true> = T;
    type ExpectedDetail =
      | {status:'idle';data:null;error:null;isFetching:false}
      | {status:'pending';data:null;error:null;isFetching:boolean}
      | {status:'success';data:ClientRow;error:null;isFetching:boolean}
      | {status:'error';data:null;error:ClientServiceError;isFetching:boolean};
    export type Detail = Assert<Equal<UseClientDetailResult,ExpectedDetail>>;
    export type DetailApi = Assert<Equal<typeof useClientDetail,(id:string|null)=>UseClientDetailResult>>;
    export type CreateApi = Assert<Equal<typeof useCreateClient,()=>ClientMutationResult<CreateClientInput>>>;
    export type UpdateApi = Assert<Equal<typeof useUpdateClient,()=>ClientMutationResult<UpdateClientVariables>>>;
    export type Variables = Assert<Equal<UpdateClientVariables,{clientId:string;input:UpdateClientInput}>>;
    export type Status = Assert<Equal<ClientMutationStatus,'idle'|'pending'|'success'|'error'>>;
    export type MutationKeys = Assert<Equal<keyof ClientMutationResult<CreateClientInput>,'status'|'data'|'error'|'mutateAsync'|'reset'>>;
    const mutation = useCreateClient();
    const promise: Promise<ClientRow> = mutation.mutateAsync({first_name:'Original'});
    if (mutation.status === 'success') { const row: ClientRow = mutation.data; void row; }
    if (mutation.status === 'error') { const error: ClientServiceError = mutation.error; void error; }
    // @ts-expect-error No business argument.
    useCreateClient('business');
    // @ts-expect-error No callback options.
    useUpdateClient({onSuccess:()=>{}});
    // @ts-expect-error Client ID goes into mutation payload, not the hook.
    useUpdateClient('client');
    // @ts-expect-error No native mutate API.
    mutation.mutate({first_name:'Original'});
    // @ts-expect-error No per-call callbacks.
    mutation.mutateAsync({first_name:'Original'}, {onSuccess:()=>{}});
    // @ts-expect-error No business ID in mutation input.
    mutation.mutateAsync({first_name:'Original',businessId:'business'});
    // @ts-expect-error No native refetch API.
    useClientDetail(null).refetch();
    // @ts-expect-error Missing clientId.
    useUpdateClient().mutateAsync({input:{is_active:false}});
    // @ts-expect-error Success requires data.
    const invalid: ClientMutationResult<CreateClientInput> = {status:'success',data:null,error:null,mutateAsync:mutation.mutateAsync,reset:mutation.reset};
    void promise; void invalid;
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
