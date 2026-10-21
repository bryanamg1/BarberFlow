/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src/features/appointments');
function load(file) {
  const code = ts.transpileModule(fs.readFileSync(file + '.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
    (name) => (name === 'zod' ? require('zod') : load(path.resolve(path.dirname(file), name))),
    module,
    module.exports,
  );
  return module.exports;
}
const schema = load(path.join(root, 'schemas/appointmentDate.schema')).appointmentCivilDateSchema;
const valid = (value) => assert.equal(schema.parse(value), value);
const invalid = (value) =>
  assert.equal(schema.safeParse(value).success, false, JSON.stringify(value));
test('BF163 normal civil date is preserved exactly as text', () => valid('2026-10-21'));
test('BF163 leap-year rules include 4/100/400 boundaries', () => {
  for (const value of ['0004-02-29', '2000-02-29', '2024-02-29', '2400-02-29']) valid(value);
});
test('BF163 non-leap years reject February 29', () => {
  for (const value of ['0001-02-29', '1900-02-29', '2025-02-29', '2100-02-29']) invalid(value);
});
test('BF163 rejects impossible months/days rather than rolling forward', () => {
  for (const value of [
    '2026-00-10',
    '2026-13-10',
    '2026-01-00',
    '2026-01-32',
    '2026-04-31',
    '2026-02-30',
  ])
    invalid(value);
});
test('BF163 requires exact YYYY-MM-DD with no trim/normalization', () => {
  for (const value of [
    '',
    '26-01-01',
    '2026-1-01',
    '2026-01-1',
    '2026/01/01',
    ' 2026-01-01',
    '2026-01-01 ',
    '2026-01-01\n',
  ])
    invalid(value);
});
test('BF163 inclusive year bounds are 0001 and 9999', () => {
  valid('0001-01-01');
  valid('9999-12-31');
});
test('BF163 year zero, negative or extended years are rejected', () => {
  for (const value of ['0000-01-01', '-0001-01-01', '+2026-01-01', '10000-01-01']) invalid(value);
});
test('BF163 no coercion from dates/numbers/null', () => {
  for (const value of [null, undefined, 20260101, true, {}, new Date('2026-01-01T00:00:00Z')])
    invalid(value);
});
test('BF163 zoned/local timestamps are not civil dates', () => {
  for (const value of ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00-03:00', '2026-01-01T00:00:00'])
    invalid(value);
});
test('BF163 device timezone cannot shift the selected civil date', () => {
  const before = process.env.TZ;
  try {
    for (const timezone of [
      'Pacific/Kiritimati',
      'America/Los_Angeles',
      'America/Argentina/Buenos_Aires',
    ]) {
      process.env.TZ = timezone;
      valid('2026-03-08');
      valid('2026-11-01');
      valid('0001-01-01');
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});
test('BF163 no today minimum, maximum booking horizon or future-only constraint', () => {
  for (const value of ['1600-01-01', '1900-01-01', '9999-12-31']) valid(value);
});
