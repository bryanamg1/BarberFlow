/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const sdk = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '..');

// Exercise service code; replace only its repository boundary unless testing both layers.
function loadService(repository, client) {
  function load(relative) {
    const filename = path.resolve(root, relative);
    const module = { exports: {} };
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const localRequire = (name) => {
      if (name === '@supabase/supabase-js') return sdk;
      if (name === '../repositories/authRepository') {
        return repository
          ? { authRepository: repository }
          : load('src/features/auth/repositories/authRepository.ts');
      }
      assert.equal(name, '@/lib/supabase/client');
      assert(client);
      return { supabase: client };
    };
    vm.runInThisContext(`(function(require, module, exports) {${compiled}\n})`, { filename })(
      localRequire,
      module,
      module.exports,
    );
    return module.exports;
  }
  return load('src/features/auth/services/authService.ts').authService;
}

const credentials = { email: 'synthetic@example.test', password: 'synthetic-password' };
const session = { access_token: 'synthetic-token', user: { id: 'synthetic-user' } };
const secret = 'synthetic-private-error-details';

function assertSafeFailure(result, code) {
  assert.equal(result.data, null);
  assert.equal(result.error.code, code);
  assert.deepEqual(Object.keys(result.error).sort(), ['code', 'message']);
  assert.equal(typeof result.error.message, 'string');
  assert(result.error.message.length > 0);
  assert(!JSON.stringify(result).includes(secret));
}

test('Importing the service does not invoke Auth or subscribe', () => {
  loadService(new Proxy({}, { get: () => assert.fail('Unexpected operation on import') }));
});

for (const [method, args, data] of [
  ['signInWithPassword', [credentials], { session, user: session.user }],
  ['getSession', [], { session }],
  ['getUser', [], { user: session.user }],
  ['signOut', [], null],
]) {
  test(`${method}: delegates once and preserves success data`, async () => {
    let calls = 0;
    const repository = {
      [method](...received) {
        assert.equal(this, repository);
        assert.deepEqual(received, args);
        calls++;
        return Promise.resolve(method === 'signOut' ? { error: null } : { data, error: null });
      },
    };
    const result = await loadService(repository)[method](...args);
    assert.equal(result.data, data);
    assert.equal(result.error, null);
    assert.equal(calls, 1);
  });

  test(`${method}: returned errors and rejected operations become safe failures without retries`, async () => {
    for (const rejects of [false, true]) {
      const error = new sdk.AuthApiError(secret, 400, 'invalid_credentials');
      let calls = 0;
      const service = loadService({
        [method]() {
          calls++;
          return rejects ? Promise.reject(error) : Promise.resolve({ data: session, error });
        },
      });
      assertSafeFailure(await service[method](...args), 'AUTH_INVALID_CREDENTIALS');
      assert.equal(calls, 1);
    }
  });
}

test('Reading an absent session succeeds with session null', async () => {
  const data = { session: null };
  const service = loadService({ getSession: async () => ({ data, error: null }) });
  assert.deepEqual(await service.getSession(), { data, error: null });
});

test('SDK codes/types select safe domain errors, independent of raw messages', async () => {
  const cases = [
    [new sdk.AuthInvalidCredentialsError(secret), 'AUTH_INVALID_CREDENTIALS'],
    [new sdk.AuthSessionMissingError(), 'AUTH_UNAUTHORIZED'],
    [new sdk.AuthApiError(secret, 401, 'no_authorization'), 'AUTH_UNAUTHORIZED'],
    [new sdk.AuthInvalidJwtError(secret), 'AUTH_SESSION_EXPIRED'],
    ...[
      'bad_jwt',
      'session_expired',
      'session_not_found',
      'refresh_token_not_found',
      'refresh_token_already_used',
    ].map((code) => [new sdk.AuthApiError(secret, 401, code), 'AUTH_SESSION_EXPIRED']),
    [new sdk.AuthRetryableFetchError(secret, 0), 'NETWORK_ERROR'],
    [new sdk.AuthApiError(secret, 429, 'over_request_rate_limit'), 'UNKNOWN_ERROR'],
    [new sdk.AuthUnknownError(secret, { password: secret, access_token: secret }), 'UNKNOWN_ERROR'],
    [new Error(`invalid_credentials ${secret}`), 'UNKNOWN_ERROR'],
    [new TypeError(`Failed to fetch ${secret}`), 'UNKNOWN_ERROR'],
    [{ code: 'bad_jwt', message: secret, metadata: { token: secret } }, 'UNKNOWN_ERROR'],
  ];
  for (const [error, code] of cases) {
    const service = loadService({ getUser: async () => ({ data: { user: session.user }, error }) });
    assertSafeFailure(await service.getUser(), code);
  }
});

test('Unexpected synchronous exceptions and primitive rejections do not expose internal details', async () => {
  const service = loadService({
    getSession: () => {
      throw new Error(secret);
    },
  });
  assertSafeFailure(await service.getSession(), 'UNKNOWN_ERROR');
  for (const value of [secret, undefined, null]) {
    const rejected = loadService({ getUser: () => Promise.reject(value) });
    assertSafeFailure(await rejected.getUser(), 'UNKNOWN_ERROR');
  }
});

test('Subscription callback, events and cancellation remain owned by the consumer', () => {
  let listener;
  let calls = 0;
  const subscription = {
    unsubscribe: () => {
      listener = null;
    },
  };
  const callbackEvents = [];
  const callback = (event, value) => callbackEvents.push([event, value]);
  const service = loadService({
    onAuthStateChange(received) {
      calls++;
      listener = received;
      return subscription;
    },
  });
  assert.equal(service.onAuthStateChange(callback), subscription);
  assert.equal(listener, callback);
  listener('SIGNED_IN', session);
  listener('SIGNED_OUT', null);
  assert.deepEqual(callbackEvents, [
    ['SIGNED_IN', session],
    ['SIGNED_OUT', null],
  ]);
  assert.equal(callbackEvents[0][1], session);
  subscription.unsubscribe();
  assert.equal(listener, null);
  assert.equal(calls, 1);
});

test('Real BF-090 repository and installed SDK integrate with service for signed-out state', async () => {
  const client = sdk.createClient('https://synthetic.supabase.co', 'synthetic-anon-key', {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: () => assert.fail('No remote calls are authorized in this test') },
  });
  const service = loadService(null, client);
  let subscription;
  try {
    const event = new Promise((resolve) => {
      subscription = service.onAuthStateChange((name, value) => resolve({ name, value }));
    });
    assert.deepEqual(await event, { name: 'INITIAL_SESSION', value: null });
    subscription.unsubscribe();
    assert.deepEqual(await service.getSession(), { data: { session: null }, error: null });
    assertSafeFailure(await service.getUser(), 'AUTH_UNAUTHORIZED');
    assert.deepEqual(await service.signOut(), { data: null, error: null });
  } finally {
    subscription?.unsubscribe();
    client.auth.stopAutoRefresh();
  }
});
