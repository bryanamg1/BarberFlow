const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load, b, input, data, response, uuid } = require('./helpers/bf216.cjs');
function service(reply) {
  const calls = [];
  const value = load('services/purchasesService', {
    '../repositories/purchasesRepository': {
      purchasesRepository: {
        completePurchase: async (...args) => {
          calls.push(args);
          return reply();
        },
      },
    },
  }).purchasesService;
  return { value, calls };
}
test('BF216 service validates BF210 and separate business before calling repository', async () => {
  const { value, calls } = service(() => response());
  for (const [business, payload] of [
    [' ', input],
    [null, input],
    [b, { ...input, items: [] }],
    [b, { ...input, operationId: '' }],
  ])
    assert.equal((await value.completePurchase(business, payload)).error.code, 'INVALID_INPUT');
  assert.equal(calls.length, 0);
  const result = await value.completePurchase(b, {
    ...input,
    notes: '',
    total: 100,
    business_id: uuid(99),
    items: input.items.map((i) => ({ ...i, line_total: 10 })),
  });
  assert.equal(result.error, null);
  assert.deepEqual(calls[0], [b, { ...input, notes: '' }]);
});
test('BF216 service returns original historical identity without comparing retry payload', async () => {
  const original = data();
  original.purchase.status = 'VOIDED';
  const { value } = service(() => response(original));
  const result = await value.completePurchase(b, {
    ...input,
    supplierName: 'Different',
    expenseCategoryId: uuid(98),
    paymentMethod: 'DIGITAL_WALLET',
    purchasedAt: '2020-01-01T00:00:00Z',
    notes: 'Different',
    items: [{ productId: uuid(99), quantity: 1, unitCost: '9.00' }],
  });
  assert.equal(result.error, null);
  assert.strictEqual(result.data, original);
});
for (const [status, code, details, expected] of [
  [0, '', '', 'NETWORK_ERROR'],
  [401, '', '', 'ACCESS_DENIED'],
  [403, '', '', 'ACCESS_DENIED'],
  [400, '42501', '', 'ACCESS_DENIED'],
  [400, '22023', '', 'INVALID_INPUT'],
  [400, '22P02', '', 'INVALID_INPUT'],
  [409, 'PT409', 'INVALID_STATUS', 'INVALID_STATUS'],
  [409, 'PT409', 'other', 'UNKNOWN_ERROR'],
  [409, '40001', '', 'CONFLICT'],
  [409, '40P01', '', 'CONFLICT'],
  [409, '23505', '', 'CONFLICT'],
  [500, '22003', '', 'UNKNOWN_ERROR'],
  [500, 'other', '', 'UNKNOWN_ERROR'],
])
  test(`BF216 safe error ${status}/${code}/${details}`, async () => {
    const { value } = service(() =>
      response(null, { code, details, message: 'SENSITIVE SQL fixture' }, status),
    );
    const result = await value.completePurchase(b, input);
    assert.equal(result.data, null);
    assert.equal(result.error.code, expected);
    assert.deepEqual(Object.keys(result.error).sort(), ['code', 'message']);
    assert(!JSON.stringify(result).includes('SENSITIVE'));
  });
const corruptions = {
  invalidInstant: (row) => {
    row.purchase.purchased_at = '1';
    return row;
  },
  invalidCivilDate: (row) => {
    row.expense.expense_date = '2026-02-30';
    return row;
  },
  outOfRangeMoney: (row) => {
    row.items[0].unit_cost_snapshot = 10_000_000_000;
    return row;
  },
  empty: () => null,
  array: (row) => [row],
  missingExpense: (row) => {
    delete row.expense;
    return row;
  },
  emptyItems: (row) => ({ ...row, items: [] }),
  wrongBusiness: (row) => {
    row.purchase.business_id = uuid(99);
    return row;
  },
  wrongOperation: (row) => {
    row.purchase.operation_id = uuid(99);
    return row;
  },
  wrongItemParent: (row) => {
    row.items[0].purchase_id = uuid(99);
    return row;
  },
  wrongExpenseParent: (row) => {
    row.expense.purchase_id = uuid(99);
    return row;
  },
  wrongExpenseBusiness: (row) => {
    row.expense.business_id = uuid(99);
    return row;
  },
  wrongExpenseCreator: (row) => {
    row.expense.created_by = uuid(99);
    return row;
  },
  wrongExpenseAmount: (row) => {
    row.expense.amount = 1;
    return row;
  },
  wrongNotes: (row) => {
    row.expense.notes = 'different';
    return row;
  },
  wrongSource: (row) => {
    row.expense.source_type = 'MANUAL';
    return row;
  },
  draft: (row) => {
    row.purchase.status = 'DRAFT';
    return row;
  },
  nan: (row) => {
    row.purchase.total = NaN;
    return row;
  },
  numericString: (row) => {
    row.purchase.total = '0.87';
    return row;
  },
  hiddenContext: (row) => {
    row.purchase.payment_method = 'CASH';
    return row;
  },
  duplicatedId: (row) => {
    row.items.push({ ...row.items[0] });
    return row;
  },
};
for (const [name, corrupt] of Object.entries(corruptions))
  test(`BF216 incoherent success ${name} fails closed`, async () => {
    const { value } = service(() => response(corrupt(data())));
    assert.equal((await value.completePurchase(b, input)).error.code, 'UNKNOWN_ERROR');
  });
test('BF216 thrown errors are safe UNKNOWN_ERROR, including an unclassified TypeError', async () => {
  for (const error of [new Error('SQL fixture'), new TypeError('fixture')]) {
    const { value } = service(() => {
      throw error;
    });
    assert.equal((await value.completePurchase(b, input)).error.code, 'UNKNOWN_ERROR');
  }
});
test('BF216 UUID identity comparison accepts canonical output for uppercase input', async () => {
  const original = data();
  original.purchase.operation_id = 'abcdef00-0000-4000-8000-000000000001';
  const { value } = service(() => response(original));
  assert.equal(
    (
      await value.completePurchase(b, {
        ...input,
        operationId: original.purchase.operation_id.toUpperCase(),
      })
    ).error,
    null,
  );
});
