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
const componentFile = path.join(root, 'src/features/auth/components/LogoutButton.tsx');
const routeFile = path.join(root, 'src/app/(app)/settings/index.tsx');
const success = { data: null, error: null };
const failure = {
  data: null,
  error: {
    code: 'NETWORK_ERROR',
    message: 'No se pudo conectar con el servicio. Inténtalo nuevamente.',
  },
};
const genericMessage = 'No se pudo completar la operación. Inténtalo nuevamente.';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function loader(
  hooks = React,
  operation = () => assert.fail('No Auth operation on render'),
  realUI = false,
) {
  const cache = new Map();
  const native = realUI
    ? require('react-native-web')
    : {
        View: 'View',
        Text: 'Text',
        StyleSheet: { create: (styles) => styles },
        Platform: { OS: 'web', select: (values) => values.web ?? values.default },
      };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = (name) => {
      if (name === 'react') return filename === componentFile ? hooks : React;
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return native;
      if (name === 'react-native-safe-area-context')
        return { SafeAreaView: realUI ? native.View : 'SafeAreaView' };
      if (name === '../services/authService') return { authService: { signOut: operation } };
      if (name === '@/components/ui')
        return {
          Button: realUI ? load(path.join(root, 'src/components/ui/Button.tsx')).Button : 'Button',
        };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/')
          ? path.join(root, 'src', name.slice(2))
          : path.resolve(path.dirname(filename), name);
        const target = ['.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find(fs.existsSync);
        assert(target, `Missing module ${name}`);
        assert(
          target === componentFile || target.startsWith(path.join(root, 'src/theme')),
          `Unexpected dependency ${name}: logout must not access SDK, repository, routing, storage or business`,
        );
        return load(target);
      }
      assert.fail(`Unexpected dependency ${name}`);
    };
    const consoleBoundary = new Proxy(
      {},
      { get: () => () => assert.fail('Logout must not log Auth data') },
    );
    vm.runInThisContext(`(function(require,module,exports,console){${code}\n})`, { filename })(
      localRequire,
      module,
      module.exports,
      consoleBoundary,
    );
    cache.set(filename, module.exports);
    return module.exports;
  }
  return {
    component: load(componentFile).LogoutButton,
    route: () => load(routeFile).default,
    load,
  };
}

function descendants(element) {
  if (!element || typeof element !== 'object') return [];
  if (Array.isArray(element)) return element.flatMap(descendants);
  return [element, ...descendants(element.props?.children)];
}

// Exercise actual LogoutButton logic, controlling only React lifecycle and authService.signOut.
// Shared Button semantics are also exercised with real React/Web rendering below.
function harness(operation = () => Promise.resolve(success)) {
  const cells = [];
  let cursor = 0;
  let writes = 0;
  let effect;
  let cleanup;
  const calls = [];
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = initial;
      return [
        cells[index],
        (value) => {
          cells[index] = value;
          writes++;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = { current: initial };
      return cells[index];
    },
    useEffect(callback) {
      effect = callback;
    },
  };
  const loaded = loader(hooks, (...args) => {
    calls.push(args);
    return operation();
  });
  const render = () => {
    cursor = 0;
    return loaded.component();
  };
  render();
  cleanup = effect();
  return {
    ...loaded,
    calls,
    render,
    button: () => descendants(render()).find((node) => node.type === 'Button').props,
    alerts: () => descendants(render()).filter((node) => node.props?.role === 'alert'),
    press: () =>
      descendants(render())
        .find((node) => node.type === 'Button')
        .props.onPress(),
    flush: () => new Promise((resolve) => setImmediate(resolve)),
    writes: () => writes,
    unmount: () => cleanup(),
    replayEffect: () => {
      cleanup();
      cleanup = effect();
    },
  };
}

test('BF-097: authenticated Settings contains exactly one reusable logout action without calling Auth on render', () => {
  const loaded = loader();
  const tree = loaded.route()();
  const nodes = descendants(tree);
  assert.equal(nodes.filter((node) => node.type === loaded.component).length, 1);
  assert.equal(tree.type, 'SafeAreaView');
  assert.deepEqual(tree.props.edges, ['left', 'right', 'bottom']);
  assert(nodes.some((node) => node.props?.children === 'Configuración'));
  const logout = harness();
  assert.equal(logout.button().label, 'Cerrar sesión');
  assert.equal(logout.button().loading, false);
  assert.equal(logout.calls.length, 0);
  logout.replayEffect();
  assert.equal(logout.calls.length, 0, 'Effect replay does not sign out');
});

test('BF-097: immediate duplicate presses call signOut once and loading disables the shared Button', async () => {
  const pending = deferred();
  const logout = harness(() => pending.promise);
  const press = logout.button().onPress;
  press();
  press();
  press(); // No render between presses: a loading-only guard would miss this.
  assert.deepEqual(logout.calls, [[]]);
  assert.equal(logout.button().loading, true);
  assert.equal(logout.alerts().length, 0);
  pending.resolve(success);
  await logout.flush();
  assert.equal(logout.button().loading, false);
  assert.equal(logout.alerts().length, 0);
});

test('BF-097: normalized failure is announced without technical fields and retry clears it', async () => {
  const retry = deferred();
  let attempts = 0;
  const logout = harness(() =>
    ++attempts === 1
      ? Promise.resolve({
          ...failure,
          error: { ...failure.error, raw: 'PRIVATE-SDK-DETAIL', token: 'PRIVATE-TOKEN' },
        })
      : retry.promise,
  );
  logout.press();
  await logout.flush();
  const [alert] = logout.alerts();
  assert.equal(alert.props.children, failure.error.message);
  assert.equal(alert.props['aria-live'], 'assertive');
  assert.equal(logout.button().loading, false);
  logout.press();
  assert.equal(logout.calls.length, 2);
  assert.equal(logout.alerts().length, 0);
  assert.equal(logout.button().loading, true);
  retry.resolve(success);
  await logout.flush();
  assert.equal(logout.alerts().length, 0);
  assert.equal(logout.button().loading, false);
});

for (const kind of ['reject', 'throw']) {
  test(`BF-097: unexpected ${kind} never exposes raw Auth details and allows retry`, async () => {
    let attempts = 0;
    const raw = new Error('RAW-SUPABASE-ERROR access_token=PRIVATE-TOKEN');
    const logout = harness(() => {
      if (++attempts > 1) return Promise.resolve(success);
      if (kind === 'throw') throw raw;
      return Promise.reject(raw);
    });
    logout.press();
    await logout.flush();
    assert.equal(logout.alerts()[0].props.children, genericMessage);
    assert.equal(logout.button().loading, false);
    logout.press();
    await logout.flush();
    assert.equal(logout.calls.length, 2);
    assert.equal(logout.alerts().length, 0);
  });
}

for (const outcome of ['success', 'failure', 'reject']) {
  test(`BF-097: ${outcome} after session-driven unmount causes no local update or extra action`, async () => {
    const pending = deferred();
    const logout = harness(() => pending.promise);
    const latePress = logout.button().onPress;
    logout.press();
    logout.unmount(); // BF095/BF096 own session loss and remove the authenticated screen.
    const before = logout.writes();
    if (outcome === 'reject') pending.reject(new Error('RAW-PRIVATE-DETAIL'));
    else pending.resolve(outcome === 'success' ? success : failure);
    await logout.flush();
    assert.equal(logout.writes(), before);
    latePress();
    assert.equal(logout.calls.length, 1);
    assert.equal(logout.writes(), before);
  });
}

test('BF-097: real React/Web Settings exposes an accessible enabled logout button with no request on render', () => {
  const loaded = loader(React, undefined, true);
  const html = renderToStaticMarkup(React.createElement(loaded.route()));
  assert.match(html, /aria-label="Cerrar sesión"/);
  assert.match(html, /role="button"/);
  // React Native Web omits false aria-disabled on a native, enabled button.
  assert(!html.includes('aria-disabled="true"'));
  assert.doesNotMatch(html, /<button[^>]*\sdisabled(?:[=\s>])/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-busy="false"/);
  assert(html.includes('Configuración'));
  assert(!html.includes('<input'));
});

test('BF-097: the actual shared Button blocks a pending logout and keeps its accessible label', async () => {
  const pending = deferred();
  const logout = harness(() => pending.promise);
  logout.press();
  const loaded = loader(React, undefined, true);
  const Button = loaded.load(path.join(root, 'src/components/ui/Button.tsx')).Button;
  const html = renderToStaticMarkup(React.createElement(Button, logout.button()));
  assert.match(html, /aria-label="Cerrar sesión"/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /aria-busy="true"/);
  assert(html.includes('Cerrar sesión'));
  pending.resolve(success);
  await logout.flush();
});

test('BF-097: action contains no competing routing, session mutation, storage, recovery or business behavior', () => {
  const source = fs.readFileSync(componentFile, 'utf8');
  assert(
    !/router\.|setSession|localStorage|AsyncStorage|SecureStore|access_token|refresh_token/.test(
      source,
    ),
  );
  assert(!/resetPasswordForEmail|updateUser|business_members|membership|console\./.test(source));
  assert(!source.includes('supabase'));
  assert(!source.includes('authRepository'));
  assert(!source.includes('useAuth'));
});
