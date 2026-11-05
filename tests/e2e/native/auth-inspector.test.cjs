const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { validateTarget, observationExpression } = require('../../../scripts/e2e/android-auth.cjs');

const approved = {
  appId: 'dev.barberflow.e2e.bf305',
  webSocketDebuggerUrl: 'ws://127.0.0.1:8096/inspector/debug?device=test-device&page=1',
};
test('native Auth observation accepts only the isolated APK and local Metro inspector', () => {
  assert.equal(validateTarget(approved), approved.webSocketDebuggerUrl);
  for (const appId of ['com.barberflow.production', undefined])
    assert.throws(() => validateTarget({ ...approved, appId }));
  for (const webSocketDebuggerUrl of [
    'ws://example.com:8096/inspector/debug?device=test&page=1',
    'ws://127.0.0.1:8081/inspector/debug?device=test&page=1',
    'ws://127.0.0.1:8096/other?device=test&page=1',
    'ws://127.0.0.1:8096/inspector/debug?page=1',
  ])
    assert.throws(() => validateTarget({ ...approved, webSocketDebuggerUrl }));
});

test('native async observation invokes the operation once and exposes only its settled metadata', async () => {
  let release,
    calls = 0;
  const context = vm.createContext({
    action: () => {
      calls++;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  assert.equal(vm.runInContext(observationExpression('action()', 1), context), true);
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  for (let i = 0; i < 3; i++)
    assert.equal(vm.runInContext('globalThis.__bf305Observation.done', context), false);
  release({ success: true });
  await new Promise(setImmediate);
  const result = JSON.parse(
    vm.runInContext('JSON.stringify(globalThis.__bf305Observation)', context),
  );
  assert.deepEqual(result, { id: 1, done: true, value: { success: true } });
  assert.equal(calls, 1);
});

test('native async observation does not return thrown errors or sensitive causes', async () => {
  const context = vm.createContext({
    action: () => Promise.reject(new Error('sensitive test cause')),
  });
  vm.runInContext(observationExpression('action()', 2), context);
  await new Promise(setImmediate);
  assert.deepEqual(
    JSON.parse(vm.runInContext('JSON.stringify(globalThis.__bf305Observation)', context)),
    { id: 2, done: true, failed: true },
  );
});
