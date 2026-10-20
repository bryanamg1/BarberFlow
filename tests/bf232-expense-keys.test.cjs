/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/features/expenses/constants/expensesKeys.ts');
const moduleCode = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const keyModule = { exports: {} };
vm.runInThisContext(`(function(module,exports){${moduleCode}\n})`, { filename })(
  keyModule,
  keyModule.exports,
);
const { expensesKeys: keys } = keyModule.exports;
const scope = { businessId: 'b', userId: 'u', membershipId: 'm' };
const params = {
  page: 2,
  pageSize: 25,
  sourceType: 'PURCHASE',
  categoryId: 'c',
  from: '2026-09-01',
  to: '2026-10-01',
};
test('BF232 real business prefix covers both scoped list and detail', () => {
  assert.deepEqual(keys.all, ['expenses']);
  assert.deepEqual(keys.byBusiness('b'), ['expenses', 'b']);
  assert.deepEqual(keys.list(scope, params).slice(0, 2), keys.byBusiness('b'));
  assert.deepEqual(keys.detail(scope, 'e').slice(0, 2), keys.byBusiness('b'));
  assert.deepEqual(keys.detail(null, null), ['expenses', null, 'detail', null, null]);
});
test('BF232 all approved params participate, deterministic serializable key preserves civil/text values', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(keys.list(scope, params))), [
    'expenses',
    'b',
    'list',
    scope,
    params,
  ]);
  assert.deepEqual(keys.list({ ...scope }, { ...params }), keys.list(scope, params));
  for (const key of Object.keys(params))
    assert.notDeepEqual(
      keys.list(scope, {
        ...params,
        [key]: key === 'page' ? 3 : key === 'pageSize' ? 30 : 'different',
      }),
      keys.list(scope, params),
    );
});
for (const property of ['businessId', 'userId', 'membershipId'])
  test(`BF232 scope isolation ${property}`, () => {
    const other = { ...scope, [property]: 'other' };
    assert.notDeepEqual(keys.list(other, params), keys.list(scope, params));
    assert.notDeepEqual(keys.detail(other, 'e'), keys.detail(scope, 'e'));
  });
test('BF232 detail IDs isolate resources and no mutable input object is retained', () => {
  assert.notDeepEqual(keys.detail(scope, 'e1'), keys.detail(scope, 'e2'));
  const s = { ...scope };
  const p = { ...params };
  const key = keys.list(s, p);
  const snapshot = JSON.stringify(key);
  s.userId = 'other';
  p.page = 99;
  assert.equal(JSON.stringify(key), snapshot);
  assert(!snapshot.includes('token'));
  assert(!snapshot.includes('description'));
});
