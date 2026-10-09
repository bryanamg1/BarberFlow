/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const sdk = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '..');
const callback = 'https://recovery.example.test/auth/recovery'; // Test input only, never app config.
const session = { user: { id: 'synthetic-user' } };
const marker = 'barberflow.auth.recovery-pending.v1';

function setup({
  platform = 'web',
  redirect = callback,
  client,
  items = new Map(),
  storageFailure = false,
} = {}) {
  const calls = [];
  let listener;
  let exchange = async () => ({
    data: { session, user: session.user, redirectType: 'recovery' },
    error: null,
  });
  let current = session;
  let logoutError = null;
  const storage = {
    getItem: (key) => items.get(key) ?? null,
    setItem(key, value) {
      if (storageFailure) throw new Error('Synthetic storage failure');
      items.set(key, value);
    },
    removeItem: (key) => items.delete(key),
  };
  const fakeClient = {
    auth: {
      resetPasswordForEmail: async (...args) => {
        calls.push(['request', ...args]);
        return { data: {}, error: null };
      },
      exchangeCodeForSession: (...args) => {
        calls.push(['exchange', ...args]);
        return exchange(...args);
      },
      getSession: async () => ({ data: { session: current }, error: null }),
      updateUser: async (value) => {
        calls.push(['update', value]);
        return { data: { user: session.user }, error: null };
      },
      signOut: async (options) => {
        calls.push(['logout', options]);
        if (!logoutError) listener?.('SIGNED_OUT', null);
        return { error: logoutError };
      },
      onAuthStateChange: (received) => {
        listener = received;
        return {
          data: {
            subscription: {
              unsubscribe() {
                listener = undefined;
              },
            },
          },
        };
      },
    },
  };
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const localRequire = (name) => {
      if (name === '@/lib/supabase/client') return { supabase: client ?? fakeClient };
      if (name === '@/lib/supabase/storage') return { authStorage: storage };
      if (name === 'react-native') return { Platform: { OS: platform } };
      if (name === '@/lib/env') {
        // Exercise the actual environment validator with explicitly injected test values.
        const envFile = path.join(root, 'src/lib/env.ts');
        const envModule = { exports: {} };
        const envCode = ts.transpileModule(fs.readFileSync(envFile, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS },
        }).outputText;
        vm.runInThisContext(`(function(require,module,exports,process){${envCode}\n})`, {
          filename: envFile,
        })(require, envModule, envModule.exports, {
          env: {
            EXPO_PUBLIC_SUPABASE_URL: 'https://synthetic.supabase.co',
            EXPO_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-key',
            EXPO_PUBLIC_AUTH_RECOVERY_REDIRECT_URL: redirect,
          },
        });
        return envModule.exports;
      }
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + '.ts'));
      return require(name);
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
      localRequire,
      module,
      module.exports,
    );
    cache.set(filename, module.exports);
    return module.exports;
  }
  return {
    service: load(path.join(root, 'src/features/auth/services/authService.ts')).authService,
    load,
    calls,
    items,
    emit: (event, value) => listener?.(event, value),
    exchange: (operation) => {
      exchange = operation;
    },
    session: (value) => {
      current = value;
    },
    logoutError: (value) => {
      logoutError = value;
    },
  };
}

test('BF-098: Web request uses only explicit validated callback; Native uses the approved scheme', async () => {
  for (const platform of ['web', 'ios', 'android']) {
    const h = setup({ platform });
    assert.equal(
      (await h.service.requestPasswordRecovery({ email: 'synthetic@example.test' })).error,
      null,
    );
    assert.deepEqual(h.calls, [
      [
        'request',
        'synthetic@example.test',
        { redirectTo: platform === 'web' ? callback : 'barberflow://auth/recovery' },
      ],
    ]);
    assert.equal(h.items.size, 0, 'A request must not create a recovery marker');
  }
});

for (const redirect of [
  undefined,
  '',
  'invalid',
  'javascript:alert(1)',
  'https://recovery.example.test/other',
  callback + '?next=/private',
  callback + '#secret',
  'https://user:pass@recovery.example.test/auth/recovery',
]) {
  test(`BF-098: invalid or missing Web configuration is a safe failure without an Auth request (${typeof redirect === 'undefined' ? 'missing' : 'invalid'})`, async () => {
    const h = setup({ redirect: redirect === undefined ? '' : redirect });
    const result = await h.service.requestPasswordRecovery({ email: 'synthetic@example.test' });
    assert(result.error);
    assert.match(result.error.message, /no está configurada/);
    assert.equal(h.calls.length, 0);
    assert(!result.error.message.includes('https://'));
  });
}

test('BF-098: Native recovery does not require a Web URL', async () => {
  const h = setup({ platform: 'ios', redirect: '' });
  assert.equal(
    (await h.service.requestPasswordRecovery({ email: 'synthetic@example.test' })).error,
    null,
  );
});

test('BF-098: verified callback persists only purpose and reconstructs recovery after reload', async () => {
  const h = setup();
  assert.equal(h.service.isRecoveryPending(session), false);
  assert.equal((await h.service.completePasswordRecovery({ code: 'synthetic-code' })).error, null);
  assert.deepEqual([...h.items], [[marker, '1']]);
  const restarted = setup({ items: h.items });
  assert.equal(restarted.service.isRecoveryPending(session), true);
  assert.equal(restarted.service.isRecoveryPending(null), false);
  assert.equal(h.items.size, 0);
});

test('BF-098: normal SDK sessions and manipulated callback purpose cannot activate recovery', async () => {
  const h = setup();
  h.service.onAuthStateChange(() => {});
  for (const event of ['SIGNED_IN', 'INITIAL_SESSION', 'TOKEN_REFRESHED', 'USER_UPDATED']) {
    h.emit(event, session);
    assert.equal(h.service.isRecoveryPending(session), false);
  }
  h.exchange(async () => ({
    data: { session, user: session.user, redirectType: null },
    error: null,
  }));
  assert(
    (await h.service.completePasswordRecovery({ code: 'synthetic-code', type: 'recovery' })).error,
  );
  assert.equal(h.service.isRecoveryPending(session), false);
  assert.equal(h.items.size, 0);
});

test('BF-098: missing runtime recovery proof is rejected rather than asserted through a cast', async () => {
  const h = setup();
  h.exchange(async () => ({ data: { session, user: session.user }, error: null }));
  assert((await h.service.completePasswordRecovery({ code: 'synthetic-code' })).error);
  assert.equal(h.items.size, 0);
});

test('BF-098: invalid/expired callback stays safe, creates no marker and allows a fresh attempt', async () => {
  const h = setup();
  h.exchange(async () => ({
    data: { session: null },
    error: new sdk.AuthApiError('Synthetic private details', 400, 'flow_state_expired'),
  }));
  const result = await h.service.completePasswordRecovery({ code: 'synthetic-code' });
  assert(result.error);
  assert(!result.error.message.includes('Synthetic'));
  assert.equal(h.items.size, 0);
  h.exchange(async () => ({ data: { session, redirectType: 'recovery' }, error: null }));
  assert.equal(
    (await h.service.completePasswordRecovery({ code: 'fresh-synthetic-code' })).error,
    null,
  );
});

test('BF-098: overlapping callback effects exchange the one-use code exactly once', async () => {
  const h = setup();
  let finish;
  h.exchange(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = h.service.completePasswordRecovery({ code: 'synthetic-code' });
  const replay = h.service.completePasswordRecovery({ code: 'synthetic-code' });
  assert.equal(first, replay);
  assert.equal(h.calls.length, 1);
  finish({ data: { session, redirectType: 'recovery' }, error: null });
  assert.equal((await first).error, null);
});

test('BF-098: verified SDK event records purpose before notifying the Auth consumer; refresh preserves it', () => {
  const h = setup();
  const states = [];
  const subscription = h.service.onAuthStateChange((_event, value) =>
    states.push(h.service.isRecoveryPending(value)),
  );
  h.emit('PASSWORD_RECOVERY', session);
  h.emit('TOKEN_REFRESHED', session);
  h.emit('USER_UPDATED', session);
  h.emit('SIGNED_OUT', null);
  assert.deepEqual(states, [true, true, true, false]);
  assert.equal(h.items.size, 0);
  subscription.unsubscribe();
  assert.equal(h.emit('PASSWORD_RECOVERY', session), undefined);
  assert.equal(h.items.size, 0);
});

test('BF-098: password update requires recovery plus session and forwards exactly the password', async () => {
  const h = setup();
  const password = '  Synthetic é字  ';
  assert((await h.service.updatePassword({ password })).error);
  assert.equal(h.calls.length, 0);
  await h.service.completePasswordRecovery({ code: 'synthetic-code' });
  assert.equal(
    (await h.service.updatePassword({ password, confirmation: 'must-not-forward' })).error,
    null,
  );
  assert.deepEqual(h.calls.at(-1), ['update', { password }]);
  assert.equal(h.items.get(marker), '1', 'Do not clear until local logout succeeds');
  h.session(null);
  assert((await h.service.updatePassword({ password })).error);
  assert.equal(h.items.size, 0);
});

test('BF-098: failed logout retains recovery; successful retry clears it with local scope only', async () => {
  const h = setup();
  await h.service.completePasswordRecovery({ code: 'synthetic-code' });
  h.logoutError(new sdk.AuthRetryableFetchError('Synthetic network error', 0));
  assert((await h.service.signOut()).error);
  assert.equal(h.service.isRecoveryPending(session), true);
  h.logoutError(null);
  assert.equal((await h.service.signOut()).error, null);
  assert.equal(h.items.size, 0);
  assert.deepEqual(h.calls.slice(-2), [
    ['logout', { scope: 'local' }],
    ['logout', { scope: 'local' }],
  ]);
});

test('BF-098: marker persistence failure cannot silently become normal authentication', async () => {
  const h = setup({ storageFailure: true });
  assert((await h.service.completePasswordRecovery({ code: 'synthetic-code' })).error);
  assert.throws(() => h.service.isRecoveryPending(session), /storage unavailable/);
  assert.equal(h.items.size, 0);
});

test('BF-098: installed Supabase PKCE produces trusted recovery proof; no remote network or email', async () => {
  const items = new Map();
  const storage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
    removeItem: (key) => items.delete(key),
  };
  const json = (value) =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  const payload = Buffer.from(
    JSON.stringify({
      sub: '00000000-0000-4000-8000-000000000001',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  const client = sdk.createClient('https://synthetic.supabase.co', 'synthetic-key', {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      storage,
      detectSessionInUrl: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: async (url) => {
        if (String(url).includes('/recover')) return json({});
        assert(
          String(url).includes('/token?grant_type=pkce'),
          'Only mocked recovery endpoints are permitted',
        );
        return json({
          access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.synthetic`,
          refresh_token: 'synthetic-refresh',
          expires_in: 3600,
          token_type: 'bearer',
          user: { id: '00000000-0000-4000-8000-000000000001' },
        });
      },
    },
  });
  const h = setup({ client, items });
  let subscription;
  try {
    const events = [];
    subscription = h.service.onAuthStateChange((event) => events.push(event));
    await h.service.getSession();
    assert.equal(
      (await h.service.requestPasswordRecovery({ email: 'synthetic@example.test' })).error,
      null,
    );
    assert.equal(items.has(marker), false);
    assert.equal(
      (await h.service.completePasswordRecovery({ code: 'synthetic-code' })).error,
      null,
    );
    assert(events.includes('PASSWORD_RECOVERY'));
    assert.equal(h.service.isRecoveryPending((await h.service.getSession()).data.session), true);
    assert.equal(items.get(marker), '1');
  } finally {
    subscription?.unsubscribe();
    client.auth.stopAutoRefresh();
  }
});
