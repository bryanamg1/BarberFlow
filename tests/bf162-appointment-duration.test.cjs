/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src');
const cache = new Map();
function load(file) {
  file = file.endsWith('.ts') ? file : file + '.ts';
  if (cache.has(file)) return cache.get(file);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
    (name) =>
      name === 'zod'
        ? require('zod')
        : load(
            name.startsWith('@/')
              ? path.join(root, name.slice(2))
              : path.resolve(path.dirname(file), name),
          ),
    module,
    module.exports,
  );
  cache.set(file, module.exports);
  return module.exports;
}
const { calculateAppointmentDuration: calculate, resolveAppointmentDuration: resolve } = load(
  path.join(root, 'features/appointments/utils/appointmentDuration'),
);
const service = (id = 's', duration_minutes = 30, patch = {}) => ({
  id,
  duration_minutes,
  business_id: 'b',
  is_active: true,
  ...patch,
});
const item = (serviceId = 's', quantity = 1) => ({ serviceId, quantity });
test('BF162 one service × 1 and × multiple quantities', () => {
  assert.equal(calculate('b', [item()], [service()]), 30n);
  assert.equal(calculate('b', [item('s', 3)], [service()]), 90n);
});
test('BF162 multiple services and duplicate lines sum exactly in their original model', () => {
  assert.equal(
    calculate('b', [item('s', 2), item('t', 3), item('s')], [service(), service('t', 15)]),
    135n,
  );
});
test('BF162 empty/missing catalog is unavailable, not a zero-minute estimate', () => {
  assert.equal(calculate('b', [], []), null);
  assert.equal(calculate('b', [item()], []), null);
  assert.equal(calculate('b', [item()], [service('other')]), null);
});
for (const duration of [0, -1, 0.5, NaN, Infinity, undefined, null, '30', 2147483648]) {
  test(`BF162 invalid catalog duration ${String(duration)} rejected`, () => {
    assert.equal(calculate('b', [item()], [{ ...service(), duration_minutes: duration }]), null);
  });
}
test('BF162 invalid quantities and IDs do not get coerced/defaulted', () => {
  for (const quantity of [0, -1, 1.5, NaN, Infinity, undefined, '1', 2147483648])
    assert.equal(calculate('b', [{ ...item(), quantity }], [service()]), null);
  assert.equal(calculate('b', [item(' ')], [service(' ')]), null);
});
test('BF162 foreign or archived catalog row does not supply a usable default', () => {
  assert.equal(calculate('other', [item()], [service()]), null);
  assert.equal(calculate('b', [item()], [service('s', 30, { is_active: false })]), null);
});
test('BF162 int4 × int4 uses exact integer arithmetic beyond Number precision', () => {
  const base = calculate(
    'b',
    [item('s', 2147483647), item('s', 2147483647)],
    [service('s', 2147483647)],
  );
  assert.equal(base, 9223372028264841218n);
  assert.equal(resolve(base, 'OWNER', undefined), null);
  // BF145 allows a valid OWNER override instead of an overflowing default.
  assert.equal(resolve(base, 'OWNER', 45), 45);
});
test('BF162 base and override use existing positive int4 input bound', () => {
  assert.equal(resolve(30n, 'OWNER', undefined), 30);
  assert.equal(resolve(30n, 'OWNER', 45), 45);
  assert.equal(resolve(30n, 'OWNER', 2147483647), 2147483647);
  for (const value of [0, -1, 1.5, NaN, Infinity, '45', null, 2147483648])
    assert.equal(resolve(30n, 'OWNER', value), null);
});
test('BF162 BARBER default is available but every explicit override is rejected', () => {
  assert.equal(resolve(30n, 'BARBER', undefined), 30);
  assert.equal(resolve(30n, 'BARBER', 30), null);
  assert.equal(resolve(30n, 'BARBER', 45), null);
});
test('BF162 evaluation does not mutate items/catalog or merge posterior buffer', () => {
  const services = Object.freeze([Object.freeze(service())]);
  const items = Object.freeze([Object.freeze(item())]);
  assert.equal(calculate('b', items, services), 30n);
  assert.equal(resolve(30n, 'OWNER', 45), 45);
  assert.equal(services[0].duration_minutes, 30);
  assert.equal(items[0].quantity, 1);
});
