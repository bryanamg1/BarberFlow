const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createClient } = require('@supabase/supabase-js');
const { load, b, data, response, uuid } = require('./helpers/bf216.cjs');
const { voidPurchaseSchema: schema } = load('schemas/voidPurchase.schema');
const input = { operationId: uuid(20), purchaseId: uuid(4), reason: '  Original\nreason  ' };
function fixture() {
  const value = data();
  value.purchase.status = 'VOIDED';
  value.correction = {
    id: uuid(21),
    business_id: b,
    purchase_id: input.purchaseId,
    operation_id: input.operationId,
    reason: input.reason,
    created_by: uuid(22),
    created_at: value.purchase.updated_at,
  };
  value.stockMovements = [
    {
      id: uuid(23),
      business_id: b,
      product_id: uuid(3),
      type: 'ADJUSTMENT',
      quantity_delta: -3,
      unit_cost: 0.29,
      reference_type: 'PURCHASE_VOID',
      reference_id: uuid(21),
      notes: null,
      occurred_at: value.correction.created_at,
      created_by: uuid(22),
      created_at: value.correction.created_at,
    },
  ];
  return value;
}
function service(reply) {
  const calls = [];
  return {
    calls,
    value: load('services/purchasesService', {
      '../repositories/purchasesRepository': {
        purchasesRepository: {
          voidPurchase: (...args) => {
            calls.push(args);
            return reply();
          },
        },
      },
    }).purchasesService,
  };
}
test('BF216A schema preserves exact strings, strips managed input, accepts any UUID version', () => {
  for (const reason of [input.reason, '\t', '\n', 'é', 'x'.repeat(10000)]) {
    assert.deepEqual(schema.parse({ ...input, reason, created_by: uuid(50), amount: 20 }), {
      ...input,
      reason,
    });
  }
  assert.equal(
    schema.parse({ ...input, operationId: 'ABCDEFAB-0000-0000-0000-000000000000' }).operationId,
    'ABCDEFAB-0000-0000-0000-000000000000',
  );
});
for (const field of ['operationId', 'purchaseId']) {
  for (const value of [undefined, null, 1, '', 'wrong', ` ${uuid(1)}`, uuid(1).replaceAll('-', '')])
    test(`BF216A schema rejects ${field} ${JSON.stringify(value)}`, () => {
      assert.equal(schema.safeParse({ ...input, [field]: value }).success, false);
    });
}
for (const reason of [undefined, null, 1, '', '   '])
  test(`BF216A reason rejects ${JSON.stringify(reason)}`, () =>
    assert.equal(schema.safeParse({ ...input, reason }).success, false));
test('BF216A repository preserves SDK envelope/rejection and invokes exactly one RPC', async () => {
  let seen = [];
  const original = response(fixture());
  const repo = load('repositories/purchasesRepository', {
    '@/lib/supabase/client': {
      supabase: {
        rpc: (...args) => {
          seen.push(args);
          return Promise.resolve(original);
        },
      },
    },
  }).purchasesRepository;
  assert.strictEqual(await repo.voidPurchase(b, input), original);
  assert.deepEqual(seen, [
    [
      'void_purchase',
      {
        p_business_id: b,
        p_operation_id: input.operationId,
        p_purchase_id: input.purchaseId,
        p_reason: input.reason,
      },
    ],
  ]);
  const failure = new Error('private cause');
  const denied = load('repositories/purchasesRepository', {
    '@/lib/supabase/client': { supabase: { rpc: () => Promise.reject(failure) } },
  }).purchasesRepository;
  await assert.rejects(denied.voidPurchase(b, input), (error) => error === failure);
  original.data = null;
  original.error = { code: 'PT409', details: 'CONFLICT' };
  original.status = 409;
  assert.strictEqual(await repo.voidPurchase(b, input), original);
});
test('BF216A real SDK HTTP transport has one request/exact body and preserves structured errors', async () => {
  const requests = [];
  const sdk = createClient('https://fixture.example.test', 'fixture-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, init) => {
        requests.push([String(url), JSON.parse(init.body)]);
        return new Response(
          JSON.stringify({
            code: 'PT409',
            details: 'INCOMPLETE_HISTORY',
            message: 'do not expose',
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      },
    },
  });
  const repo = load('repositories/purchasesRepository', {
    '@/lib/supabase/client': { supabase: sdk },
  }).purchasesRepository;
  const result = await repo.voidPurchase(b, input);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], 'https://fixture.example.test/rest/v1/rpc/void_purchase');
  assert.deepEqual(requests[0][1], {
    p_business_id: b,
    p_operation_id: input.operationId,
    p_purchase_id: input.purchaseId,
    p_reason: input.reason,
  });
  assert.equal(result.status, 409);
  assert.equal(result.error.details, 'INCOMPLETE_HISTORY');
});
test('BF216A service preserves historical actor/result, exact reason and stripped request', async () => {
  const original = fixture();
  const { value, calls } = service(() => response(original));
  const result = await value.voidPurchase(b, { ...input, created_by: uuid(90) });
  assert.strictEqual(result.data, original);
  assert.equal(result.error, null);
  assert.deepEqual(calls, [[b, input]]);
  assert.notEqual(original.correction.created_by, original.purchase.created_by);
});
test('BF216A service rejects invalid business/input without network', async () => {
  const { value, calls } = service(() => {
    throw new Error('must not call');
  });
  for (const [business, payload] of [
    ['bad', input],
    [b, { ...input, reason: '' }],
    [b, null],
    [null, input],
  ])
    assert.equal((await value.voidPurchase(business, payload)).error.code, 'INVALID_INPUT');
  assert.equal(calls.length, 0);
});
for (const [code, details, status, expected] of [
  ['42501', null, 400, 'ACCESS_DENIED'],
  ['x', null, 401, 'ACCESS_DENIED'],
  ['x', null, 403, 'ACCESS_DENIED'],
  ['22023', null, 400, 'INVALID_INPUT'],
  ['22P02', null, 400, 'INVALID_INPUT'],
  ...['INVALID_STATUS', 'CONFLICT', 'INSUFFICIENT_STOCK', 'INCOMPLETE_HISTORY'].map((d) => [
    'PT409',
    d,
    409,
    d,
  ]),
  ...['40001', '40P01', '23505'].map((c) => [c, null, 409, 'CONFLICT']),
  ['x', null, 0, 'NETWORK_ERROR'],
  ['x', null, 500, 'UNKNOWN_ERROR'],
  ['PT409', 'unknown', 409, 'UNKNOWN_ERROR'],
])
  test(`BF216A maps ${code}/${details}/${status}`, async () => {
    const { value, calls } = service(() =>
      response(null, { code, details, message: 'SECRET INVALID_STATUS constraint' }, status),
    );
    const result = await value.voidPurchase(b, input);
    assert.equal(result.error.code, expected);
    assert.equal(result.data, null);
    assert.deepEqual(Object.keys(result.error).sort(), ['code', 'message']);
    assert(!JSON.stringify(result).includes('SECRET'));
    assert.equal(calls.length, 1);
  });
for (const [label, mutate] of [
  ['null', () => null],
  ['empty', () => ({})],
  [
    'extra key',
    (v) => {
      v.debug = true;
    },
  ],
  [
    'target',
    (v) => {
      v.purchase.id = uuid(99);
    },
  ],
  [
    'business',
    (v) => {
      v.purchase.business_id = uuid(99);
    },
  ],
  [
    'status',
    (v) => {
      v.purchase.status = 'COMPLETED';
    },
  ],
  [
    'item linkage',
    (v) => {
      v.items[0].purchase_id = uuid(99);
    },
  ],
  [
    'expense link',
    (v) => {
      v.expense.purchase_id = uuid(99);
    },
  ],
  [
    'audit business',
    (v) => {
      v.correction.business_id = uuid(99);
    },
  ],
  [
    'audit purchase',
    (v) => {
      v.correction.purchase_id = uuid(99);
    },
  ],
  [
    'audit op',
    (v) => {
      v.correction.operation_id = uuid(99);
    },
  ],
  [
    'reason',
    (v) => {
      v.correction.reason = input.reason.trim();
    },
  ],
  [
    'movement ref',
    (v) => {
      v.stockMovements[0].reference_id = uuid(99);
    },
  ],
  [
    'movement type',
    (v) => {
      v.stockMovements[0].reference_type = 'PURCHASE';
    },
  ],
  [
    'movement qty',
    (v) => {
      v.stockMovements[0].quantity_delta = -2;
    },
  ],
  [
    'movement cost',
    (v) => {
      v.stockMovements[0].unit_cost = 1;
    },
  ],
  [
    'movement actor',
    (v) => {
      v.stockMovements[0].created_by = uuid(99);
    },
  ],
  [
    'movement timestamp',
    (v) => {
      v.stockMovements[0].occurred_at = '2026-01-01T00:00:00Z';
    },
  ],
  [
    'empty movements',
    (v) => {
      v.stockMovements = [];
    },
  ],
  [
    'extra movements',
    (v) => {
      v.stockMovements.push({ ...v.stockMovements[0], id: uuid(24) });
    },
  ],
])
  test(`BF216A incoherent success ${label} fails closed`, async () => {
    const original = fixture();
    const changed = mutate(original);
    const { value } = service(() => response(changed === undefined ? original : changed));
    assert.equal((await value.voidPurchase(b, input)).error.code, 'UNKNOWN_ERROR');
  });
test('BF216A unexpected rejection maps UNKNOWN without retry', async () => {
  const { value, calls } = service(() => Promise.reject(new Error('private cause')));
  assert.equal((await value.voidPurchase(b, input)).error.code, 'UNKNOWN_ERROR');
  assert.equal(calls.length, 1);
});

test('BF216A retains nullable historical purchased_at and duplicate line multiplicities', async () => {
  const original = fixture();
  original.purchase.purchased_at = null;
  original.items.push({ ...original.items[0], id: uuid(7) });
  original.stockMovements.push({ ...original.stockMovements[0], id: uuid(24) });
  const { value } = service(() => response(original));
  assert.strictEqual((await value.voidPurchase(b, input)).data, original);
  original.stockMovements[1].quantity_delta = -2;
  assert.equal((await value.voidPurchase(b, input)).error.code, 'UNKNOWN_ERROR');
});
