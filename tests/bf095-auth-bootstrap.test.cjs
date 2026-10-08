/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const providerFile = path.join(root, 'src/features/auth/context/AuthContext.tsx');
const initial = { status: 'initializing', session: null, user: null, error: null };
const safeError = {
  code: 'NETWORK_ERROR',
  message: 'No se pudo conectar con el servicio. Inténtalo nuevamente.',
};
const unknownError = {
  code: 'UNKNOWN_ERROR',
  message: 'No se pudo completar la operación. Inténtalo nuevamente.',
};
const session = {
  user: { id: 'synthetic-user' },
  access_token: 'SYNTHETIC-ACCESS',
  refresh_token: 'SYNTHETIC-REFRESH',
};
const result = (value) => ({ data: { session: value }, error: null });
const flush = () => new Promise((resolve) => setImmediate(resolve));

function compile(filename, localRequire) {
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${source}\n})`, { filename })(
    localRequire,
    module,
    module.exports,
  );
  return module.exports;
}

function boundary() {
  const reads = [];
  const subscriptions = [];
  const order = [];
  const active = new Set();
  const service = {
    getSession() {
      order.push('getSession');
      let resolve;
      let reject;
      const promise = new Promise((accept, fail) => {
        resolve = accept;
        reject = fail;
      });
      reads.push({ resolve, reject });
      return promise;
    },
    onAuthStateChange(callback) {
      order.push('subscribe');
      const subscription = {
        callback,
        unsubscribes: 0,
        unsubscribe() {
          this.unsubscribes++;
          active.delete(subscription);
        },
      };
      subscriptions.push(subscription);
      active.add(subscription);
      return subscription;
    },
  };
  return { service, reads, subscriptions, order, active };
}

// Exercise the actual provider effect and state transitions, controlling only React lifecycle
// scheduling and authService. A real React context/SSR integration test follows below.
function harness(mock = boundary()) {
  let state;
  let initialized = false;
  let writes = 0;
  let effect;
  let cleanup;
  let value;
  const hooks = {
    ...React,
    useState(start) {
      if (!initialized) {
        state = start;
        initialized = true;
      }
      return [
        state,
        (next) => {
          state = typeof next === 'function' ? next(state) : next;
          writes++;
        },
      ];
    },
    useEffect(setup) {
      effect ??= setup;
    },
    useContext: () => value,
  };
  const exports = compile(providerFile, (name) => {
    if (name === 'react') return hooks;
    if (name === '../services/authService') return { authService: mock.service };
    assert.equal(
      name,
      'react/jsx-runtime',
      'Provider must not import routing, storage, SDK or business modules',
    );
    return require(name);
  });
  function render() {
    const element = exports.AuthProvider({ children: 'preserved-content' });
    value = element.props.value;
    assert.equal(element.props.children, 'preserved-content');
    return value;
  }
  return {
    ...mock,
    exports,
    read: render,
    writes: () => writes,
    mount() {
      render();
      cleanup = effect();
    },
    replayEffect() {
      cleanup();
      cleanup = effect();
    },
    unmount() {
      cleanup();
    },
  };
}

test('BF-095: exact initial API, children preserved and listener registered before session read', () => {
  const auth = harness();
  assert.deepEqual(Object.keys(auth.exports).sort(), ['AuthProvider', 'useAuth']);
  assert.throws(() => auth.exports.useAuth(), /useAuth debe usarse dentro de AuthProvider/);
  assert.deepEqual(auth.read(), initial);
  assert.deepEqual(auth.exports.useAuth(), initial);
  assert.equal(auth.reads.length, 0);
  auth.mount();
  assert.deepEqual(auth.order, ['subscribe', 'getSession']);
  assert.deepEqual(auth.read(), initial);
  assert.equal(auth.active.size, 1);
  auth.unmount();
});

test('BF-095: initial session authenticates and derives user from the same session', async () => {
  const auth = harness();
  auth.mount();
  auth.reads[0].resolve(result(session));
  await flush();
  const state = auth.read();
  assert.deepEqual(state, { status: 'authenticated', session, user: session.user, error: null });
  assert.equal(state.session, session);
  assert.equal(state.user, session.user);
  auth.unmount();
});

test('BF-095: confirmed null session ends initialization as unauthenticated', async () => {
  const auth = harness();
  auth.mount();
  auth.reads[0].resolve(result(null));
  await flush();
  assert.deepEqual(auth.read(), {
    status: 'unauthenticated',
    session: null,
    user: null,
    error: null,
  });
  auth.unmount();
});

test('BF-095: normalized initial error remains error, keeps only safe fields and performs no retry', async () => {
  const auth = harness();
  auth.mount();
  auth.reads[0].resolve({
    data: null,
    error: { ...safeError, cause: 'PRIVATE', stack: 'STACK', metadata: session },
  });
  await flush();
  await flush();
  assert.deepEqual(auth.read(), { status: 'error', session: null, user: null, error: safeError });
  assert.equal(auth.reads.length, 1);
  assert.equal(auth.active.size, 1);
  const callbackResult = auth.subscriptions[0].callback('SIGNED_IN', session);
  assert.equal(callbackResult, undefined, 'Listener callback is synchronous');
  assert.equal(auth.read().error, null);
  assert.equal(auth.read().status, 'authenticated');
  assert.equal(auth.reads.length, 1, 'Listener performs no Auth read');
  auth.unmount();
});

for (const mode of ['rejection', 'synchronous read', 'subscription']) {
  test(`BF-095: unexpected ${mode} failure is sanitized and never leaves initializing`, async () => {
    const mock = boundary();
    const fail = () => {
      throw new Error('RAW PASSWORD TOKEN STACK');
    };
    if (mode === 'synchronous read') mock.service.getSession = fail;
    if (mode === 'subscription') mock.service.onAuthStateChange = fail;
    const auth = harness(mock);
    auth.mount();
    if (mode === 'rejection') auth.reads[0].reject(new Error('RAW PASSWORD TOKEN STACK'));
    await flush();
    assert.deepEqual(auth.read(), {
      status: 'error',
      session: null,
      user: null,
      error: unknownError,
    });
    auth.unmount();
  });
}

for (const event of [
  'INITIAL_SESSION',
  'SIGNED_IN',
  'TOKEN_REFRESHED',
  'USER_UPDATED',
  'PASSWORD_RECOVERY',
]) {
  test(`BF-095: ${event} applies the received session without event-specific side effects`, async () => {
    const auth = harness();
    auth.mount();
    auth.reads[0].resolve(result(session));
    await flush();
    const updated = { ...session, access_token: 'REPLACED', user: { id: 'updated-user' } };
    assert.equal(auth.subscriptions[0].callback(event, updated), undefined);
    const state = auth.read();
    assert.equal(state.status, 'authenticated');
    assert.equal(state.session, updated);
    assert.equal(state.user, updated.user);
    assert.equal(state.error, null);
    assert.equal(auth.reads.length, 1);
    assert.equal(auth.active.size, 1);
    auth.unmount();
  });
}

test('BF-095: SIGNED_OUT clears identity and error from a previously authenticated state', async () => {
  const auth = harness();
  auth.mount();
  auth.reads[0].resolve(result(session));
  await flush();
  auth.subscriptions[0].callback('SIGNED_OUT', null);
  assert.deepEqual(auth.read(), {
    status: 'unauthenticated',
    session: null,
    user: null,
    error: null,
  });
  auth.unmount();
});

for (const late of ['null', 'error', 'rejection']) {
  test(`BF-095: SIGNED_IN during initialization wins over a late ${late} read`, async () => {
    const auth = harness();
    auth.mount();
    auth.subscriptions[0].callback('SIGNED_IN', session);
    assert.equal(auth.read().status, 'authenticated');
    if (late === 'rejection') auth.reads[0].reject(new Error('PRIVATE'));
    else auth.reads[0].resolve(late === 'error' ? { data: null, error: safeError } : result(null));
    await flush();
    assert.deepEqual(auth.read(), {
      status: 'authenticated',
      session,
      user: session.user,
      error: null,
    });
    auth.unmount();
  });
}

test('BF-095: sign-out during initialization wins over a late restored session', async () => {
  const auth = harness();
  auth.mount();
  auth.subscriptions[0].callback('SIGNED_OUT', null);
  auth.reads[0].resolve(result(session));
  await flush();
  assert.equal(auth.read().status, 'unauthenticated');
  assert.equal(auth.read().session, null);
  auth.unmount();
});

test('BF-095: cleanup unsubscribes its subscription and ignores pending reads and late callbacks', async () => {
  const auth = harness();
  auth.mount();
  const subscription = auth.subscriptions[0];
  auth.unmount();
  const writes = auth.writes();
  assert.equal(subscription.unsubscribes, 1);
  assert.equal(auth.active.size, 0);
  subscription.callback('SIGNED_IN', session);
  auth.reads[0].resolve(result(session));
  await flush();
  assert.equal(auth.writes(), writes);
});

test('BF-095: Strict Mode setup/cleanup/setup has independent controls and no permanent duplicate listener', async () => {
  const auth = harness();
  auth.mount();
  const first = auth.subscriptions[0];
  auth.replayEffect();
  const second = auth.subscriptions[1];
  assert.notEqual(first, second);
  assert.equal(first.unsubscribes, 1);
  assert.equal(auth.active.size, 1);
  assert.equal(auth.reads.length, 2);
  first.callback('SIGNED_IN', session);
  auth.reads[0].resolve(result(session));
  await flush();
  assert.deepEqual(auth.read(), initial, 'Old execution cannot initialize the new execution');
  const updated = { ...session, user: { id: 'new-execution' } };
  second.callback('SIGNED_IN', updated);
  auth.reads[1].resolve({ data: null, error: safeError });
  await flush();
  assert.equal(auth.read().session, updated);
  first.callback('SIGNED_OUT', null);
  assert.equal(auth.read().session, updated);
  auth.unmount();
  assert.equal(second.unsubscribes, 1);
  assert.equal(first.unsubscribes, 1);
  assert.equal(auth.active.size, 0);
});

test('BF-095: real React Context preserves children and exposes initializing during SSR without Auth reads', () => {
  const exports = compile(providerFile, (name) => {
    if (name === 'react') return React;
    if (name === '../services/authService')
      return {
        authService: new Proxy({}, { get: () => assert.fail('No Auth operation during SSR') }),
      };
    assert.equal(name, 'react/jsx-runtime');
    return require(name);
  });
  function Consumer() {
    const state = exports.useAuth();
    assert.deepEqual(state, initial);
    return React.createElement('span', null, 'preserved-content');
  }
  assert.equal(
    renderToStaticMarkup(
      React.createElement(exports.AuthProvider, null, React.createElement(Consumer)),
    ),
    '<span>preserved-content</span>',
  );
  assert.throws(
    () => renderToStaticMarkup(React.createElement(Consumer)),
    /useAuth debe usarse dentro de AuthProvider/,
  );
});

test('BF-095: root mounts AuthProvider inside QueryProvider around the unchanged Stack and font gate', () => {
  let fontsLoaded = true;
  const Stack = Object.assign(function Stack() {}, { Screen: 'StackScreen' });
  const exports = compile(path.join(root, 'src/app/_layout.tsx'), (name) => {
    if (name.startsWith('@expo-google-fonts/inter/')) return new Proxy({}, { get: () => 1 });
    if (name === 'expo-font')
      return { FontDisplay: { BLOCK: 'block' }, useFonts: () => [fontsLoaded, null] };
    if (name === 'expo-splash-screen')
      return { preventAutoHideAsync: () => Promise.resolve(), hide: () => {} };
    if (name === 'expo-router') return { Stack };
    if (name === 'react') return { useEffect: () => {} };
    if (name === '@/features/auth/context/AuthContext') return { AuthProvider: 'AuthProvider' };
    if (name === '@/lib/query') return { QueryProvider: 'QueryProvider' };
    if (name === '@/theme/typography')
      return {
        fontFamilies: { regular: 'regular', medium: 'medium', semibold: 'semibold', bold: 'bold' },
      };
    assert.equal(name, 'react/jsx-runtime');
    return require(name);
  });
  const tree = exports.default();
  assert.equal(tree.type, 'QueryProvider');
  assert.equal(tree.props.children.type, 'AuthProvider');
  const stack = tree.props.children.props.children;
  assert.equal(stack.type, Stack);
  assert.deepEqual(
    stack.props.children.map((node) => node.props.name),
    ['(app)', '(auth)'],
  );
  assert.deepEqual(exports.unstable_settings, { initialRouteName: '(app)' });
  fontsLoaded = false;
  assert.equal(exports.default(), null);
});
