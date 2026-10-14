/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/features/inventory/repositories/inventoryRepository.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const columns =
  'id,business_id,product_id,type,quantity_delta,unit_cost,reference_type,reference_id,notes,occurred_at,created_by,created_at';
const movement = Object.freeze({
  id: 'movement',
  business_id: 'business',
  product_id: 'product',
  type: 'LOSS',
  quantity_delta: -3,
  unit_cost: null,
  reference_type: null,
  reference_id: null,
  notes: ' Original ',
  occurred_at: '2026-01-01T00:00:00.123456+00:00',
  created_by: 'actor',
  created_at: '2026-01-01T00:00:00Z',
});
const response = (data = [], error = null, status = 200) => ({
  data,
  error,
  status,
  count: null,
  statusText: 'fixture',
});
function repository(client) {
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(
    (name) => {
      assert.equal(name, '@/lib/supabase/client');
      return { supabase: client };
    },
    module,
    module.exports,
  );
  assert.deepEqual(Object.keys(module.exports), ['inventoryRepository']);
  assert.deepEqual(Object.keys(module.exports.inventoryRepository), [
    'getProductStock',
    'getLowStockProducts',
    'listStockMovements',
  ]);
  return module.exports.inventoryRepository;
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
  for (const method of ['select', 'eq', 'gte', 'lt', 'order', 'range', 'overrideTypes'])
    chain[method] = (...args) => {
      if (method !== 'overrideTypes') calls.push([method, ...args]);
      return chain;
    };
  return {
    calls,
    repo: repository({
      from(table) {
        calls.push(['from', table]);
        return chain;
      },
      rpc(name, args) {
        calls.push(['rpc', name, args]);
        return chain;
      },
    }),
  };
}
const invoke = (repo, method) =>
  method === 'getProductStock'
    ? repo.getProductStock(' Original B ', ['z', 'a', 'z'])
    : method === 'getLowStockProducts'
      ? repo.getLowStockProducts(' Original B ', { page: 2, pageSize: 25 })
      : repo.listStockMovements(' Original B ', ' Original P ', { page: 2, pageSize: 25 });

test('BF220 inert import has only normal singleton runtime dependency and exactly three read methods', () => {
  repository(new Proxy({}, { get: () => assert.fail('No import-time client access') }));
});
test('BF220 product-stock RPC preserves the explicit tenant and original ordered/duplicate IDs', async () => {
  const data = [{ product_id: 'p', current_stock: '9007199254740993' }];
  const result = response(data);
  const h = boundary(result);
  assert.equal(await invoke(h.repo, 'getProductStock'), result);
  assert.equal(result.data, data);
  assert.deepEqual(h.calls, [
    ['rpc', 'get_product_stock', { p_business_id: ' Original B ', p_product_ids: ['z', 'a', 'z'] }],
  ]);
});
test('BF220 empty product IDs are transported, with no fabricated zero or alternate query', async () => {
  const result = response([]);
  const h = boundary(result);
  assert.equal(await h.repo.getProductStock('b', []), result);
  assert.deepEqual(h.calls, [
    ['rpc', 'get_product_stock', { p_business_id: 'b', p_product_ids: [] }],
  ]);
});
test('BF220 low-stock RPC preserves params and exact response values instead of filtering or aggregating locally', async () => {
  const data = [
    { product_id: 'p', name: ' Original ', minimum_stock: 3, current_stock: '-5' },
    { product_id: 'q', name: 'Zero', minimum_stock: 0, current_stock: '0' },
  ];
  const result = response(data);
  const h = boundary(result);
  assert.equal(await invoke(h.repo, 'getLowStockProducts'), result);
  assert.equal(result.data, data);
  assert.deepEqual(h.calls, [
    [
      'rpc',
      'get_low_stock_products',
      { p_business_id: ' Original B ', p_page: 2, p_page_size: 25 },
    ],
  ]);
});
test('BF220 ledger reads exact twelve fields, two mandatory IDs, descending event/id and inclusive lookahead', async () => {
  const rows = [movement, { ...movement, id: 'sentinel' }];
  const result = response(rows);
  const h = boundary(result);
  assert.equal(await invoke(h.repo, 'listStockMovements'), result);
  assert.equal(result.data, rows);
  assert.deepEqual(h.calls[0], ['from', 'stock_movements']);
  assert.equal(h.calls[1][1].replace(/\s/g, ''), columns);
  assert.deepEqual(h.calls.slice(2), [
    ['eq', 'business_id', ' Original B '],
    ['eq', 'product_id', ' Original P '],
    ['order', 'occurred_at', { ascending: false }],
    ['order', 'id', { ascending: false }],
    ['range', 25, 50],
  ]);
});
for (const type of ['PURCHASE', 'SALE', 'LOSS', 'ADJUSTMENT', 'RETURN']) {
  test(`BF220 type ${type} is an optional exact filter, not a quantity-sign business rule`, async () => {
    for (const quantity_delta of [-3, 2]) {
      const result = response([{ ...movement, type, quantity_delta, unit_cost: 1.01 }]);
      const h = boundary(result);
      assert.equal(
        await h.repo.listStockMovements('b', 'p', { page: 1, pageSize: 25, type }),
        result,
      );
      assert(h.calls.some((call) => call[0] === 'eq' && call[1] === 'type' && call[2] === type));
      assert.equal(result.data[0].quantity_delta, quantity_delta);
      assert.equal(result.data[0].unit_cost, 1.01);
    }
  });
}
for (const filters of [
  {},
  { from: '2026-01-01T00:00:00.123456+03:00' },
  { to: '2026-02-01T00:00:00Z' },
  { from: '2026-01-01T00:00:00.123456+03:00', to: '2026-02-01T00:00:00Z' },
]) {
  test(`BF220 optional time filters preserve zoned instants and use the approved half-open interval ${JSON.stringify(filters)}`, async () => {
    const h = boundary();
    await h.repo.listStockMovements('b', 'p', { page: 1, pageSize: 100, ...filters });
    const expected = [
      ['eq', 'business_id', 'b'],
      ['eq', 'product_id', 'p'],
    ];
    if (filters.from !== undefined) expected.push(['gte', 'occurred_at', filters.from]);
    if (filters.to !== undefined) expected.push(['lt', 'occurred_at', filters.to]);
    assert.deepEqual(h.calls.slice(2), [
      ...expected,
      ['order', 'occurred_at', { ascending: false }],
      ['order', 'id', { ascending: false }],
      ['range', 0, 100],
    ]);
  });
}
test('BF220 movement nullables, free references, notes, timestamps and costs remain historical SDK values', async () => {
  for (const unit_cost of [null, 0, 0.29, 1.01, 9_999_999_999.99]) {
    const row = {
      ...movement,
      unit_cost,
      reference_type: ' Original ',
      reference_id: 'reference',
      notes: '',
    };
    const result = response([row]);
    const h = boundary(result);
    assert.equal(await invoke(h.repo, 'listStockMovements'), result);
    assert.equal(result.data[0], row);
  }
});
for (const method of ['getProductStock', 'getLowStockProducts', 'listStockMovements']) {
  test(`BF220 ${method} preserves empty/null/error envelopes and unexpected SDK rejection`, async () => {
    for (const data of [[], null]) {
      const result = response(data);
      const h = boundary(result);
      assert.equal(await invoke(h.repo, method), result);
    }
    const error = { code: '42501', message: 'private', details: 'private', hint: 'private' };
    const result = response(null, error, 403);
    const h = boundary(result);
    assert.equal(await invoke(h.repo, method), result);
    assert.equal(result.error, error);
    const thrown = new Error('private');
    const rejected = boundary(null, thrown);
    await assert.rejects(
      async () => await invoke(rejected.repo, method),
      (value) => value === thrown,
    );
  });
}
test('BF220 absent future RPC errors remain errors with null data, never fabricated zero stock', async () => {
  for (const method of ['getProductStock', 'getLowStockProducts']) {
    const error = {
      code: 'PGRST202',
      message: 'synthetic missing producer',
      details: null,
      hint: null,
    };
    const result = response(null, error, 404);
    const h = boundary(result);
    assert.equal(await invoke(h.repo, method), result);
    assert.equal(result.data, null);
    assert.equal(result.error, error);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][0], 'rpc');
  }
});

test('BF220 installed SDK preserves large integer strings and exact RPC/history wire requests with mocked HTTP', async () => {
  const requests = [];
  const stock = [
    { product_id: 'p', current_stock: '9007199254740993' },
    { product_id: 'q', current_stock: '-9223372036854775808' },
  ];
  const low = [{ product_id: 'p', name: ' Original ', minimum_stock: 3, current_stock: '0' }];
  const sdk = createClient('https://synthetic.supabase.co', 'public-test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, options) => {
        const target = new URL(url);
        requests.push({ url: target, options });
        const data = target.pathname.endsWith('/get_product_stock')
          ? stock
          : target.pathname.endsWith('/get_low_stock_products')
            ? low
            : [movement];
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  try {
    const repo = repository(sdk);
    assert.deepEqual((await repo.getProductStock('b', ['z', 'a', 'z'])).data, stock);
    assert.deepEqual((await repo.getLowStockProducts('b', { page: 2, pageSize: 25 })).data, low);
    assert.deepEqual(
      (
        await repo.listStockMovements('b', 'p', {
          page: 2,
          pageSize: 2,
          type: 'RETURN',
          from: '2026-01-01T00:00:00.123456+03:00',
          to: '2026-02-01T00:00:00Z',
        })
      ).data,
      [movement],
    );
    assert.equal(requests.length, 3);
    assert.equal(requests[0].url.pathname, '/rest/v1/rpc/get_product_stock');
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      p_business_id: 'b',
      p_product_ids: ['z', 'a', 'z'],
    });
    assert.equal(requests[1].url.pathname, '/rest/v1/rpc/get_low_stock_products');
    assert.deepEqual(JSON.parse(requests[1].options.body), {
      p_business_id: 'b',
      p_page: 2,
      p_page_size: 25,
    });
    const query = requests[2].url.searchParams;
    assert.equal(requests[2].url.pathname, '/rest/v1/stock_movements');
    assert.equal(requests[2].options.method, 'GET');
    assert.equal(query.get('select'), columns);
    assert.equal(query.get('business_id'), 'eq.b');
    assert.equal(query.get('product_id'), 'eq.p');
    assert.equal(query.get('type'), 'eq.RETURN');
    assert.deepEqual(query.getAll('occurred_at'), [
      'gte.2026-01-01T00:00:00.123456+03:00',
      'lt.2026-02-01T00:00:00Z',
    ]);
    assert.equal(query.get('order'), 'occurred_at.desc,id.desc');
    assert.equal(query.get('offset'), '2');
    assert.equal(query.get('limit'), '3');
    assert(!requests[2].options.headers.get('Prefer')?.includes('count='));
  } finally {
    sdk.auth.stopAutoRefresh();
  }
});
test('BF220 static DTOs expose only approved read shapes and preserve stock as string', () => {
  const virtualFile = path.join(root, 'tests/__bf220_type_contract__.ts');
  const source = `
  import {inventoryRepository as repo} from '@/features/inventory/repositories/inventoryRepository';
  import type {StockMovementType,StockMovementRow,ProductStockRow,LowStockProductRow,InventoryPageParams,StockMovementListParams} from '@/features/inventory/types/inventory.types';
  type Equal<A,B>=(<T>()=>T extends A?1:2)extends(<T>()=>T extends B?1:2)?true:false;type Assert<T extends true>=T;
  type ExpectedMovement={id:string;business_id:string;product_id:string;type:'PURCHASE'|'SALE'|'LOSS'|'ADJUSTMENT'|'RETURN';quantity_delta:number;unit_cost:number|null;reference_type:string|null;reference_id:string|null;notes:string|null;occurred_at:string;created_by:string;created_at:string};
  export type Movement=Assert<Equal<StockMovementRow,ExpectedMovement>>;
  export type Stock=Assert<Equal<ProductStockRow,{product_id:string;current_stock:string}>>;
  export type Low=Assert<Equal<LowStockProductRow,ProductStockRow&{name:string;minimum_stock:number}>>;
  export type StockReturn=Assert<Equal<Awaited<ReturnType<typeof repo.getProductStock>>['data'],ProductStockRow[]|null>>;
  export type LowReturn=Assert<Equal<Awaited<ReturnType<typeof repo.getLowStockProducts>>['data'],LowStockProductRow[]|null>>;
  export type HistoryReturn=Assert<Equal<Awaited<ReturnType<typeof repo.listStockMovements>>['data'],StockMovementRow[]|null>>;
  export type PageParams=Assert<Equal<Parameters<typeof repo.getLowStockProducts>[1],InventoryPageParams>>;
  export type HistoryParams=Assert<Equal<Parameters<typeof repo.listStockMovements>[2],StockMovementListParams>>;
  // @ts-expect-error Stock cannot be represented by unsafe JS numbers.
  const badStock:ProductStockRow={product_id:'p',current_stock:9007199254740993};
  // @ts-expect-error No invented movement type.
  const type:StockMovementType='VOID';
  // @ts-expect-error No direct movement creation API.
  repo.createMovement({});
  // @ts-expect-error Append-only historical mutation is absent.
  repo.updateMovement('b','id',{});
  // @ts-expect-error Append-only historical deletion is absent.
  repo.deleteMovement('b','id');
  // @ts-expect-error No direct product stock mutation.
  repo.updateStock('b','p',5);
  // @ts-expect-error Paging must be resolved by the future service.
  repo.listStockMovements('b','p',{});
  void badStock;void type;
 `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options);
  const getSource = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) =>
    path.resolve(file) === virtualFile
      ? ts.createSourceFile(file, source, options.target ?? ts.ScriptTarget.Latest, true)
      : getSource(file, ...args);
  const program = ts.createProgram(
    [virtualFile, ...fileNames.filter((file) => file.endsWith('.d.ts'))],
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
