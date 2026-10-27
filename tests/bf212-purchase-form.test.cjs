const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load, input } = require('./helpers/bf216.cjs');
const { purchaseQuantityText, purchaseEstimate, frozenPurchaseInput } = load(
  'utils/purchaseFormValues',
);
const { completePurchaseSchema: schema } = load('schemas/purchase.schema');
test('BF212 quantity input parses full digits only, blank is invalid not zero/default1', () => {
  assert.equal(purchaseQuantityText('12'), 12);
  for (const s of ['', ' ', '1x', '1.2', '-1', 'Infinity'])
    assert(Number.isNaN(purchaseQuantityText(s)));
  for (const s of ['0', '2147483648'])
    assert.equal(
      schema.safeParse({
        ...input,
        items: [{ ...input.items[0], quantity: purchaseQuantityText(s) }],
      }).success,
      false,
    );
});
test('BF212 empty/invalid quantities and costs never produce a fabricated estimate', () => {
  assert.equal(purchaseEstimate([]), null);
  for (const q of [0, NaN, Infinity, 1.5, -1])
    assert.equal(purchaseEstimate([{ ...input.items[0], quantity: q }]), null);
  for (const c of ['', '0', '1.001', '1,00', '-1.00'])
    assert.equal(purchaseEstimate([{ ...input.items[0], unitCost: c }]), null);
});
test('BF212 exact estimate preserves zero, cents and duplicate lines without averaging', () => {
  const a = { ...input.items[0], quantity: 3, unitCost: '0.29' };
  assert.equal(purchaseEstimate([a]), '0.87');
  assert.equal(purchaseEstimate([a, a]), '1.74');
  assert.equal(purchaseEstimate([{ ...a, unitCost: '0.00' }]), '0.00');
});
test('BF212 line and total numeric12,2 bounds remain exact', () => {
  const a = { ...input.items[0], quantity: 1, unitCost: '9999999999.99' };
  assert.equal(purchaseEstimate([a]), '9999999999.99');
  assert.equal(purchaseEstimate([a, a]), null);
});
test('BF212 immutable submitted capture cannot change with later draft edits', () => {
  const original = { ...input, items: input.items.map((x) => ({ ...x })) },
    capture = frozenPurchaseInput(original);
  original.supplierName = 'later';
  original.items[0].quantity = 8;
  original.items.push({ ...input.items[0] });
  assert.equal(capture.supplierName, input.supplierName);
  assert.equal(capture.items.length, 1);
  assert.equal(capture.items[0].quantity, input.items[0].quantity);
  assert(Object.isFrozen(capture));
  assert(Object.isFrozen(capture.items));
  assert(Object.isFrozen(capture.items[0]));
});
test('BF212 complete schema keeps duplicate products only when exact costs agree', () => {
  assert(
    schema.safeParse({
      ...input,
      items: [input.items[0], { ...input.items[0], unitCost: '00.29' }],
    }).success,
  );
  assert.equal(
    schema.safeParse({ ...input, items: [input.items[0], { ...input.items[0], unitCost: '0.30' }] })
      .success,
    false,
  );
});
