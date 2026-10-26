const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./helpers/agenda.cjs');
const { appointmentFormSchema } = load('schemas/appointmentForm.schema');
const valid = () => ({
  requestId: 'request',
  clientId: 'client',
  barberMemberId: 'member',
  items: [{ serviceId: 'service', quantity: 1 }],
  date: '2026-11-01',
  slot: {
    start_at: '2026-11-01T01:30:00.000001-04:00',
    end_at: '2026-11-01T01:30:00.000001-05:00',
    available: true,
  },
});
test('BF166 composes exactly existing create DTO; preserves exact slot instant, not device reconstruction', () => {
  assert.deepEqual(appointmentFormSchema.parse(valid()), {
    requestId: 'request',
    clientId: 'client',
    barberMemberId: 'member',
    items: [{ serviceId: 'service', quantity: 1 }],
    startAt: valid().slot.start_at,
  });
});
test('BF166 strips civil date, slot end, server-owned and unknown fields from transport', () => {
  const result = appointmentFormSchema.parse({
    ...valid(),
    businessId: 'foreign',
    created_by: 'foreign',
    status: 'COMPLETED',
    startAt: 'wrong',
    extra: true,
  });
  assert.deepEqual(
    Object.keys(result).sort(),
    ['requestId', 'clientId', 'barberMemberId', 'items', 'startAt'].sort(),
  );
});
for (const field of ['clientId', 'barberMemberId', 'requestId'])
  test(`BF166 ${field} is required without silent ID rewrite`, () => {
    assert.equal(appointmentFormSchema.safeParse({ ...valid(), [field]: '' }).success, false);
    assert.equal(
      appointmentFormSchema.parse({ ...valid(), [field]: ' original ' })[field],
      ' original ',
    );
  });
test('BF166 requires explicit available slot and positive interval', () => {
  for (const slot of [
    null,
    { ...valid().slot, available: false },
    { ...valid().slot, end_at: valid().slot.start_at },
  ])
    assert.equal(appointmentFormSchema.safeParse({ ...valid(), slot }).success, false);
});
test('BF166 date is real civil date without invented horizon', () => {
  for (const date of ['2026-02-29', '', '2026-04-31'])
    assert.equal(appointmentFormSchema.safeParse({ ...valid(), date }).success, false);
  for (const date of ['0001-01-01', '2024-02-29', '9999-12-31'])
    assert.equal(appointmentFormSchema.safeParse({ ...valid(), date }).success, true);
});
test('BF166 items reuse required quantities/collection contract; do not invent deduplication', () => {
  assert.equal(appointmentFormSchema.safeParse({ ...valid(), items: [] }).success, false);
  assert.equal(
    appointmentFormSchema.safeParse({ ...valid(), items: [{ serviceId: 's', quantity: 0 }] })
      .success,
    false,
  );
  assert.equal(
    appointmentFormSchema.parse({ ...valid(), items: [...valid().items, ...valid().items] }).items
      .length,
    2,
  );
});
test('BF166 optional notes preserve absence/null/empty/original text', () => {
  assert.equal(Object.hasOwn(appointmentFormSchema.parse(valid()), 'notes'), false);
  for (const notes of [null, '', ' original \n text '])
    assert.equal(appointmentFormSchema.parse({ ...valid(), notes }).notes, notes);
});
test('BF166 optional duration reuses positive integer contract without coercion/default', () => {
  assert.equal(Object.hasOwn(appointmentFormSchema.parse(valid()), 'durationOverride'), false);
  for (const durationOverride of [0, -1, 1.5, '30'])
    assert.equal(appointmentFormSchema.safeParse({ ...valid(), durationOverride }).success, false);
  assert.equal(
    appointmentFormSchema.parse({ ...valid(), durationOverride: 30 }).durationOverride,
    30,
  );
});
