/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '..');
const feature = path.join(root, 'src/features/services');
const columns =
  'id,business_id,name,description,price,duration_minutes,is_active,created_at,updated_at';
const row = Object.freeze({
  id: 'service',
  business_id: 'business',
  name: ' Corte ',
  description: null,
  price: 0.29,
  duration_minutes: 7,
  is_active: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00.123456+00:00',
});
const input = Object.freeze({
  name: row.name,
  description: null,
  price: 0.29,
  duration_minutes: 7,
});
const extras = {
  id: 'injected',
  business_id: 'foreign',
  created_at: 'now',
  updated_at: 'now',
  role: 'OWNER',
  buffer: 15,
};
const response = (data = row, error = null, status = 200) => ({
  data,
  error,
  status,
  count: null,
  statusText: 'fixture',
});
function load(relative, dependencies = {}) {
  const filename = path.resolve(feature, relative + '.ts');
  assert(filename.startsWith(feature + path.sep));
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) => {
      if (name in dependencies) return dependencies[name];
      if (name === 'zod') return require('zod');
      assert(name.startsWith('.'), `Unexpected runtime dependency: ${name}`);
      return load(path.relative(feature, path.resolve(path.dirname(filename), name)), dependencies);
    },
    module,
    module.exports,
  );
  return module.exports;
}
function repository(client) {
  const exports = load('repositories/servicesRepository', {
    '@/lib/supabase/client': { supabase: client },
  });
  assert.deepEqual(Object.keys(exports), ['servicesRepository']);
  assert.deepEqual(Object.keys(exports.servicesRepository), [
    'getById',
    'create',
    'update',
    'listByBusiness',
  ]);
  return exports.servicesRepository;
}
function boundary(result = response(), rejection) {
  const calls = [];
  const chain = {
    then(resolve, reject) {
      return (rejection ? Promise.reject(rejection) : Promise.resolve(result)).then(
        resolve,
        reject,
      );
    },
  };
  for (const method of [
    'select',
    'eq',
    'insert',
    'update',
    'single',
    'maybeSingle',
    'order',
    'range',
    'overrideTypes',
  ]) {
    chain[method] = (...args) => {
      if (method !== 'overrideTypes') calls.push([method, ...args]);
      return chain;
    };
  }
  const repo = repository({
    from: (table) => {
      calls.push(['from', table]);
      return chain;
    },
  });
  return { repo, calls };
}
const invoke = (repo, method, value = input) =>
  method === 'listByBusiness'
    ? repo.listByBusiness(' Business ', { page: 2, pageSize: 2, status: 'all' })
    : method === 'create'
      ? repo.create(' Business ', value)
      : method === 'getById'
        ? repo.getById(' Business ', ' Service ')
        : repo.update(' Business ', ' Service ', value);

test('BF-131 repository import is inert; only normal singleton runtime dependency and approved methods', () => {
  repository(new Proxy({}, { get: () => assert.fail('Client must be unused during import') }));
});
test('BF-131 getById scopes both original IDs, includes archived rows and maybeSingle without active filter', async () => {
  for (const is_active of [true, false]) {
    const result = response({ ...row, is_active });
    const h = boundary(result);
    assert.equal(await invoke(h.repo, 'getById'), result);
    assert.deepEqual(h.calls.slice(0, 1), [['from', 'services']]);
    assert.equal(h.calls[1][1].replace(/\s/g, ''), columns);
    assert.deepEqual(h.calls.slice(2), [
      ['eq', 'business_id', ' Business '],
      ['eq', 'id', ' Service '],
      ['maybeSingle'],
    ]);
  }
});
test('BF-131 create allowlists payload, keeps zero/description variants and uses argument tenant with one returning call', async () => {
  for (const description of [undefined, null, '', ' text ']) {
    const result = response();
    const h = boundary(result);
    assert.equal(
      await invoke(h.repo, 'create', {
        ...input,
        ...extras,
        is_active: false,
        description,
        price: 0,
      }),
      result,
    );
    assert.equal(h.calls[0][1], 'services');
    assert.deepEqual(h.calls[1], [
      'insert',
      { business_id: ' Business ', name: input.name, description, price: 0, duration_minutes: 7 },
    ]);
    assert.equal(h.calls[2][1].replace(/\s/g, ''), columns);
    assert.deepEqual(h.calls.slice(3), [['single']]);
  }
});
for (const patch of [
  { name: ' Other ' },
  { description: null },
  { description: '' },
  { price: 0 },
  { duration_minutes: 13 },
  { is_active: false },
  { is_active: true },
  { ...input, is_active: false },
  { description: undefined, price: 1.01 },
]) {
  test(`BF-131 update preserves partial defined fields ${JSON.stringify(patch)}`, async () => {
    const h = boundary();
    await invoke(h.repo, 'update', { ...patch, ...extras });
    assert.equal(h.calls[0][1], 'services');
    assert.deepEqual(h.calls[1], [
      'update',
      Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    ]);
    assert.deepEqual(h.calls.slice(2, 4), [
      ['eq', 'business_id', ' Business '],
      ['eq', 'id', ' Service '],
    ]);
    assert.equal(h.calls[4][1].replace(/\s/g, ''), columns);
    assert.deepEqual(h.calls.slice(5), [['maybeSingle']]);
  });
}
for (const status of ['active', 'inactive', 'all']) {
  test(`BF-131 list ${status} uses tenant/projection/name-id order and inclusive extra-row sentinel`, async () => {
    const result = response([]);
    const h = boundary(result);
    assert.equal(
      await h.repo.listByBusiness(' Original B ', { status, page: 3, pageSize: 25 }),
      result,
    );
    assert.equal(h.calls[0][1], 'services');
    assert.equal(h.calls[1][1].replace(/\s/g, ''), columns);
    const filters = [['eq', 'business_id', ' Original B ']];
    if (status !== 'all') filters.push(['eq', 'is_active', status === 'active']);
    assert.deepEqual(h.calls.slice(2), [
      ...filters,
      ['order', 'name', { ascending: true }],
      ['order', 'id', { ascending: true }],
      ['range', 50, 75],
    ]);
  });
}
for (const method of ['getById', 'create', 'update', 'listByBusiness']) {
  test(`BF-131 repository ${method} preserves raw SDK errors and unexpected rejection`, async () => {
    const error = { code: '42501', message: 'private', details: 'private', hint: 'private' };
    const result = response(null, error, 403);
    const h = boundary(result);
    assert.equal(await invoke(h.repo, method), result);
    const thrown = new Error('private');
    const rejected = boundary(null, thrown);
    await assert.rejects(
      async () => await invoke(rejected.repo, method),
      (e) => e === thrown,
    );
  });
}
test('BF-131 get/update null responses stay null with no fabricated not-found error', async () => {
  for (const method of ['getById', 'update']) {
    const result = response(null);
    const h = boundary(result);
    assert.equal(await invoke(h.repo, method), result);
  }
});
test('BF-131 actual installed SDK serializes one request per operation without networking', async () => {
  const requests = [];
  const sdk = createClient('http://fixture.invalid', 'synthetic-public-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url, options) => {
        requests.push({ url: new URL(url), options });
        return new Response(JSON.stringify(options.method === 'GET' ? [row] : row), {
          status: 200,
        });
      },
    },
  });
  const repo = repository(sdk);
  await repo.getById('b', 's');
  await repo.create('b', { ...input, description: undefined });
  await repo.update('b', 's', { description: '', price: 0, is_active: false });
  await repo.listByBusiness('b', { status: 'all', page: 2, pageSize: 2 });
  assert.equal(requests.length, 4);
  for (const request of requests) {
    assert.equal(request.url.pathname, '/rest/v1/services');
    assert.equal(request.url.searchParams.get('select'), columns);
  }
  assert.equal(requests[0].url.searchParams.get('business_id'), 'eq.b');
  assert.equal(requests[0].url.searchParams.get('id'), 'eq.s');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    business_id: 'b',
    name: input.name,
    price: 0.29,
    duration_minutes: 7,
  });
  assert.deepEqual(JSON.parse(requests[2].options.body), {
    description: '',
    price: 0,
    is_active: false,
  });
  assert.equal(requests[2].url.searchParams.get('business_id'), 'eq.b');
  assert.equal(requests[2].url.searchParams.get('id'), 'eq.s');
  assert.equal(requests[3].url.searchParams.get('order'), 'name.asc,id.asc');
  assert.equal(requests[3].url.searchParams.get('offset'), '2');
  assert.equal(requests[3].url.searchParams.get('limit'), '3');
});

function service(operation) {
  const calls = [];
  const repo = Object.fromEntries(
    ['getById', 'create', 'update', 'listByBusiness'].map((method) => [
      method,
      (...args) => {
        calls.push([method, ...args]);
        return operation(method, ...args);
      },
    ]),
  );
  return {
    api: load('services/servicesService', {
      '../repositories/servicesRepository': { servicesRepository: repo },
    }).servicesService,
    calls,
  };
}
const callService = (api, method, value = input) =>
  method === 'list'
    ? api.list(' Business ', value)
    : method === 'create'
      ? api.create(' Business ', value)
      : method === 'getById'
        ? api.getById(' Business ', ' Service ')
        : api.update(' Business ', ' Service ', value);
test('BF-131 service exposes only list/getById/create/update and preserves successful rows including inactive', async () => {
  const h = service(async () => response());
  assert.deepEqual(Object.keys(h.api), ['getById', 'create', 'update', 'list']);
  for (const method of ['getById', 'create', 'update']) {
    const result = await callService(h.api, method);
    assert.equal(result.data, row);
    assert.equal(result.error, null);
  }
  assert.deepEqual(h.calls, [
    ['getById', ' Business ', ' Service '],
    ['create', ' Business ', input],
    ['update', ' Business ', ' Service ', input],
  ]);
});
test('BF-131 service validates BF130 writes, strips extras and preserves false/null/empty/zero', async () => {
  const h = service(async () => response());
  const payload = { ...input, ...extras, price: 0, description: '', is_active: false };
  await h.api.create('b', payload);
  await h.api.update('b', 's', payload);
  assert.deepEqual(h.calls, [
    ['create', 'b', { ...input, price: 0, description: '' }],
    ['update', 'b', 's', { ...input, price: 0, description: '', is_active: false }],
  ]);
  await h.api.update('b', 's', { description: null });
  assert.deepEqual(h.calls[2], ['update', 'b', 's', { description: null }]);
});
test('BF-131 invalid write input never reaches repository and exposes safe unknown error', async () => {
  const h = service(async () => assert.fail('No invalid write'));
  for (const [method, values] of [
    [
      'create',
      [{}, { ...input, price: '0.29' }, { ...input, duration_minutes: 0 }, { ...input, name: '' }],
    ],
    ['update', [{}, extras, { is_active: 'false' }, { price: 1.001 }, { description: undefined }]],
  ]) {
    for (const value of values) {
      const result = await callService(h.api, method, value);
      assert.equal(result.data, null);
      assert.equal(result.error.code, 'UNKNOWN_ERROR');
    }
  }
  assert.equal(h.calls.length, 0);
});
test('BF-131 service list defaults/empty page succeed and sentinel is removed without count guesses', async () => {
  let rows = [];
  const h = service(async () => response(rows));
  assert.deepEqual(await h.api.list('b'), {
    data: { items: [], page: 1, pageSize: 25, hasNextPage: false },
    error: null,
  });
  assert.deepEqual(h.calls[0], [
    'listByBusiness',
    'b',
    { page: 1, pageSize: 25, status: 'active' },
  ]);
  rows = [row, { ...row, id: '2' }, { ...row, id: '3' }];
  assert.deepEqual(await h.api.list('b', { page: 2, pageSize: 2, status: 'inactive' }), {
    data: { items: rows.slice(0, 2), page: 2, pageSize: 2, hasNextPage: true },
    error: null,
  });
  rows = rows.slice(0, 2);
  assert.equal((await h.api.list('b', { pageSize: 2, status: 'all' })).data.hasNextPage, false);
});
test('BF-131 malformed pagination fails before SDK, including unsafe range endpoints', async () => {
  const h = service(async () => assert.fail('No invalid read'));
  for (const params of [
    { page: 0 },
    { page: -1 },
    { page: 1.5 },
    { page: '1' },
    { page: Infinity },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    { pageSize: 0 },
    { pageSize: 101 },
    { pageSize: '25' },
    { status: 'unknown' },
    { status: false },
  ]) {
    const result = await h.api.list('b', params);
    assert.equal(result.error.code, 'UNKNOWN_ERROR');
  }
  assert.equal(h.calls.length, 0);
});
for (const method of ['getById', 'create', 'update', 'list']) {
  test(`BF-131 service ${method} uses safe structured error priority, no raw SDK detail`, async () => {
    for (const [status, code, expected] of [
      [0, '42501', 'NETWORK_ERROR'],
      [401, 'x', 'SERVICE_ACCESS_DENIED'],
      [403, 'x', 'SERVICE_ACCESS_DENIED'],
      [400, '42501', 'SERVICE_ACCESS_DENIED'],
      [500, 'x', 'UNKNOWN_ERROR'],
    ]) {
      const h = service(async () =>
        response(
          null,
          { code, message: 'sensitive', hint: 'sensitive', details: 'sensitive' },
          status,
        ),
      );
      const result = await callService(h.api, method, method === 'list' ? {} : input);
      assert.equal(result.data, null);
      assert.equal(result.error.code, expected);
      assert.deepEqual(Object.keys(result.error), ['code', 'message']);
      assert(!JSON.stringify(result).includes('sensitive'));
    }
    const rejected = service(async () => {
      throw new Error('sensitive');
    });
    assert.equal(
      (await callService(rejected.api, method, method === 'list' ? {} : input)).error.code,
      'UNKNOWN_ERROR',
    );
  });
}
test('BF-131 null data maps safely by operation; empty collection is not not-found', async () => {
  const h = service(async () => response(null));
  for (const method of ['getById', 'update'])
    assert.equal((await callService(h.api, method)).error.code, 'SERVICE_NOT_FOUND');
  for (const method of ['create', 'list'])
    assert.equal(
      (await callService(h.api, method, method === 'list' ? {} : input)).error.code,
      'UNKNOWN_ERROR',
    );
});

test('BF-131 public types match the nine-column row, SDK nullable results and safe service API', () => {
  const virtualFile = path.join(root, 'tests/__bf131_type_contract__.ts');
  const source = `
    import { servicesRepository, type ServiceRow } from '@/features/services/repositories/servicesRepository';
    import { servicesService } from '@/features/services/services/servicesService';
    import type { ServiceResult,ServiceListResult } from '@/features/services/types/service.types';
    type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true>=T;
    type Expected={id:string;business_id:string;name:string;description:string|null;price:number;duration_minutes:number;is_active:boolean;created_at:string;updated_at:string};
    export type Row=Assert<Equal<ServiceRow,Expected>>;
    export type Get=Assert<Equal<Awaited<ReturnType<typeof servicesRepository.getById>>['data'],ServiceRow|null>>;
    export type Update=Assert<Equal<Awaited<ReturnType<typeof servicesRepository.update>>['data'],ServiceRow|null>>;
    export type Create=Assert<Equal<Awaited<ReturnType<typeof servicesRepository.create>>['data'],ServiceRow|null>>;
    export type List=Assert<Equal<Awaited<ReturnType<typeof servicesRepository.listByBusiness>>['data'],ServiceRow[]|null>>;
    export type ServiceGet=Assert<Equal<Awaited<ReturnType<typeof servicesService.getById>>,ServiceResult>>;
    export type ServiceList=Assert<Equal<Awaited<ReturnType<typeof servicesService.list>>,ServiceListResult>>;
    // @ts-expect-error No physical delete.
    servicesRepository.delete;
    // @ts-expect-error No separate archive method.
    servicesRepository.archive;
    // @ts-expect-error No search.
    servicesRepository.search;
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const { options, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const host = ts.createCompilerHost(options),
    getSource = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) =>
    path.resolve(file) === virtualFile
      ? ts.createSourceFile(file, source, options.target ?? ts.ScriptTarget.Latest, true)
      : getSource(file, ...args);
  const program = ts.createProgram(
    [virtualFile, ...fileNames.filter((f) => f.endsWith('.d.ts'))],
    { ...options, noEmit: true },
    host,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (f) => f,
      getNewLine: () => '\n',
    }),
  );
});
