/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient, isCancelledError } = require('@tanstack/react-query');
const file = path.join(__dirname, '../src/lib/query/privateState.ts');
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename: file })(
    (name) => {
      assert.equal(name, './client');
      return { queryClient: client };
    },
    module,
    module.exports,
  );
  return { client, clear: module.exports.clearPrivateQueryState };
}
test('BF305 private cache: all real user/tenant families and mutation bookkeeping are removed synchronously', () => {
  const { client, clear } = setup();
  for (const family of [
    'business',
    'clients',
    'services',
    'products',
    'productCategories',
    'expenses',
    'expenseCategories',
    'purchases',
    'sales',
    'appointments',
    'inventory',
    'analytics',
    'home',
    'profile',
    'profile-avatar',
  ])
    client.setQueryData([family, 'user-or-business-a'], { private: true });
  client.getMutationCache().build(client, { mutationKey: ['appointments', 'business-a'] });
  clear();
  assert.equal(client.getQueryCache().getAll().length, 0);
  assert.equal(client.getMutationCache().getAll().length, 0);
});
test('BF305 private cache: repeated cleanup is idempotent', () => {
  const { client, clear } = setup();
  clear();
  clear();
  assert.equal(client.getQueryCache().getAll().length, 0);
});
test('BF305 private cache: signal-aware requests are aborted before removal', async () => {
  const { client, clear } = setup();
  let aborted = false;
  const request = client
    .fetchQuery({
      queryKey: ['clients', 'a'],
      queryFn: ({ signal }) =>
        new Promise(() => {
          signal.addEventListener('abort', () => {
            aborted = true;
          });
        }),
    })
    .catch((e) => e);
  clear();
  assert.equal(aborted, true);
  assert.ok(isCancelledError(await request));
  assert.equal(client.getQueryCache().getAll().length, 0);
});
test('BF305 private cache: a late response ignoring AbortSignal cannot restore A after B', async () => {
  const { client, clear } = setup();
  let resolve;
  const request = client
    .fetchQuery({
      queryKey: ['clients', 'a'],
      queryFn: () =>
        new Promise((r) => {
          resolve = r;
        }),
    })
    .catch((e) => e);
  clear();
  client.setQueryData(['clients', 'b'], { owner: 'b' });
  resolve({ owner: 'a' });
  assert.ok(isCancelledError(await request));
  await Promise.resolve();
  assert.equal(client.getQueryData(['clients', 'a']), undefined);
  assert.deepEqual(client.getQueryData(['clients', 'b']), { owner: 'b' });
  clear();
});
