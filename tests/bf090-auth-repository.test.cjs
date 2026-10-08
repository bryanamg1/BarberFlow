/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient, AuthApiError } = require('@supabase/supabase-js');

const filename = path.resolve(__dirname, '../src/features/auth/repositories/authRepository.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

// Replace only the shared client boundary; exercise the actual repository implementation.
function loadRepository(client) {
  const module = { exports: {} };
  const localRequire = (name) => {
    assert.equal(name, '@/lib/supabase/client');
    return { supabase: client };
  };
  vm.runInThisContext(`(function(require, module, exports) {${compiled}\n})`, { filename })(
    localRequire,
    module,
    module.exports,
  );
  return module.exports.authRepository;
}

const credentials = { email: 'synthetic@example.test', password: 'synthetic-test-password' };
const session = { access_token: 'synthetic-token', user: { id: 'synthetic-user' } };
const sdkError = new AuthApiError('Synthetic failure', 400, 'invalid_credentials');

test('Importing the repository does not read session state, subscribe or call Auth', () => {
  loadRepository({
    get auth() {
      assert.fail('Auth must only be accessed when an operation is called');
    },
  });
});

for (const [method, args, expectedArgs, data] of [
  ['signInWithPassword', [credentials], [credentials], { session, user: session.user }],
  ['getSession', [], [], { session }],
  ['getUser', [], [], { user: session.user }],
  ['signOut', [], [{ scope: 'local' }], undefined],
]) {
  test(`${method}: uses shared Auth with exact arguments and preserves SDK success/error results`, async () => {
    const results = [
      { ...(data && { data }), error: null },
      {
        ...(data && { data: Object.fromEntries(Object.keys(data).map((key) => [key, null])) }),
        error: sdkError,
      },
    ];
    const auth = {
      [method](...received) {
        assert.equal(this, auth, 'SDK method must retain its client context');
        assert.deepEqual(received, expectedArgs);
        return Promise.resolve(results.shift());
      },
    };
    const repository = loadRepository({ auth });
    for (const result of [...results]) {
      assert.equal(await repository[method](...args), result);
    }
    assert.equal(results.length, 0);
  });
}

test('Email/password login excludes extra runtime options and does not normalize credentials', async () => {
  const input = {
    ...credentials,
    email: ' MixedCase@example.test ',
    options: { captchaToken: 'extra' },
  };
  const repository = loadRepository({
    auth: {
      signInWithPassword(received) {
        assert.deepEqual(received, { email: input.email, password: input.password });
        return Promise.resolve({ data: { session: null, user: null }, error: sdkError });
      },
    },
  });
  assert.equal((await repository.signInWithPassword(input)).error, sdkError);
});

test('A missing session is returned as a successful null session', async () => {
  const result = { data: { session: null }, error: null };
  const repository = loadRepository({ auth: { getSession: () => Promise.resolve(result) } });
  assert.equal(await repository.getSession(), result);
});

test('Unexpected SDK promise rejection is preserved rather than converted to success', async () => {
  const failure = new Error('Synthetic SDK rejection');
  const repository = loadRepository({ auth: { getUser: () => Promise.reject(failure) } });
  await assert.rejects(repository.getUser(), (error) => error === failure);
});

test('Auth callbacks receive unchanged events/session and returned subscription owns cleanup', () => {
  const callbacks = new Set();
  const subscriptions = [];
  const auth = {
    onAuthStateChange(callback) {
      assert.equal(this, auth);
      callbacks.add(callback);
      const subscription = { unsubscribe: () => callbacks.delete(callback) };
      subscriptions.push(subscription);
      return { data: { subscription } };
    },
  };
  const repository = loadRepository({ auth });
  const received = [];
  const callback = (event, value) => received.push([event, value]);
  const subscription = repository.onAuthStateChange(callback);
  assert.equal(subscription, subscriptions[0]);
  assert(callbacks.has(callback));
  for (const listener of callbacks) {
    listener('SIGNED_IN', session);
    listener('TOKEN_REFRESHED', session);
    listener('SIGNED_OUT', null);
  }
  assert.deepEqual(received, [
    ['SIGNED_IN', session],
    ['TOKEN_REFRESHED', session],
    ['SIGNED_OUT', null],
  ]);
  assert.equal(received[0][1], session);
  subscription.unsubscribe();
  assert.equal(callbacks.size, 0);
});

test('Installed SDK integrates with repository for empty session, current user and subscription cleanup', async () => {
  // Synthetic client only: no remote Auth, credentials, storage persistence or database access.
  const client = createClient('https://synthetic.supabase.co', 'synthetic-anon-key', {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: () => assert.fail('Empty-session checks must not contact a server') },
  });
  const repository = loadRepository(client);
  let subscription;
  try {
    const event = new Promise((resolve) => {
      subscription = repository.onAuthStateChange((name, value) => resolve({ name, value }));
    });
    assert.deepEqual(await event, { name: 'INITIAL_SESSION', value: null });
    subscription.unsubscribe();
    assert.deepEqual(await repository.getSession(), { data: { session: null }, error: null });
    const result = await repository.getUser();
    assert.equal(result.data.user, null);
    assert.equal(result.error.name, 'AuthSessionMissingError');
    assert.deepEqual(await repository.signOut(), { error: null });
  } finally {
    subscription?.unsubscribe();
    client.auth.stopAutoRefresh();
  }
});
