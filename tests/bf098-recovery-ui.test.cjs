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

// Run the installed RHF hooks, Controller, resolver and schema. Only React's hook lifecycle,
// native hosts and the authService boundary are controlled; no validation or form logic is mocked.
function harness(component = 'RecoveryRequestForm', operations = {}, authStatus = 'recovering') {
  const cache = new Map();
  const stores = new Map();
  const effects = [];
  const calls = [];
  let active;
  let cursor;
  let dirty = true;
  let nodes = [];
  const equalDeps = (a, b) =>
    a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  function memo(factory, deps) {
    const index = cursor++;
    if (!active[index] || !equalDeps(active[index].deps, deps)) {
      active[index] = { value: factory(), deps };
    }
    return active[index].value;
  }
  function effect(callback, deps) {
    const index = cursor++;
    const store = active;
    if (!store[index] || !equalDeps(store[index].deps, deps)) {
      const previous = store[index];
      store[index] = { deps };
      effects.push(() => {
        previous?.cleanup?.();
        store[index].cleanup = callback();
      });
    }
  }
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      const store = active;
      if (!(index in store)) store[index] = typeof initial === 'function' ? initial() : initial;
      return [
        store[index],
        (value) => {
          const next = typeof value === 'function' ? value(store[index]) : value;
          if (!Object.is(next, store[index])) {
            store[index] = next;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial) {
      return memo(() => ({ current: initial }), []);
    },
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect: effect,
    useLayoutEffect: effect,
    useContext: (context) => context._currentValue,
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = fs.readFileSync(filename, 'utf8');
    const code =
      filename.endsWith('.ts') || filename.endsWith('.tsx')
        ? ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
          }).outputText
        : source;
    const localRequire = (name) => {
      if (name === 'react') return hooks;
      if (name === 'react-hook-form') return load(require.resolve(name));
      if (name === 'react-native')
        return {
          Platform: { OS: 'web', select: (options) => options.web ?? options.default },
          View: 'View',
          Text: 'Text',
          StyleSheet: { create: (s) => s },
        };
      if (name === '@/components/ui')
        return { Input: 'Input', PasswordInput: 'PasswordInput', Button: 'Button' };
      if (name === '@/features/auth/context/AuthContext')
        return { useAuth: () => ({ status: authStatus }) };
      if (name.endsWith('/authService'))
        return {
          authService: new Proxy(
            {},
            {
              get:
                (_target, method) =>
                async (...args) => {
                  calls.push({ method, args });
                  return operations[method]
                    ? operations[method](...args)
                    : { data: null, error: null };
                },
            },
          ),
        };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/')
          ? path.join(root, 'src', name.slice(2))
          : path.resolve(path.dirname(filename), name);
        const target = ['.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find(fs.existsSync);
        assert(target, `Missing module: ${name}`);
        return load(target);
      }
      return require(name);
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
      localRequire,
      module,
      module.exports,
    );
    return module.exports;
  }
  const { [component]: Form } = load(
    path.join(root, 'src/features/auth/components/' + component + '.tsx'),
  );
  function visit(element, key) {
    if (!element || typeof element !== 'object') return;
    if (Array.isArray(element)) {
      element.forEach((child, i) => visit(child, `${key}.${i}`));
      return;
    }
    if (typeof element.type === 'function') {
      if (!stores.has(key)) stores.set(key, []);
      active = stores.get(key);
      cursor = 0;
      visit(element.type(element.props), `${key}.render`);
    } else {
      nodes.push(element);
      visit(element.props?.children, `${key}.child`);
    }
  }
  function render() {
    let passes = 0;
    do {
      dirty = false;
      nodes = [];
      visit(React.createElement(Form, {}), 'form');
      effects.splice(0).forEach((run) => run());
      assert(++passes < 30, 'Render must converge');
    } while (dirty);
  }
  render();
  return {
    calls,
    field: (type) => nodes.find((node) => node.type === type)?.props,
    fields: (type) => nodes.filter((node) => node.type === type).map((node) => node.props),
    render,
    text: () =>
      nodes
        .filter((node) => node.type === 'Text')
        .map((node) => node.props.children)
        .join(' '),
    fill(...values) {
      const fields = nodes.filter((node) => ['Input', 'PasswordInput'].includes(node.type));
      fields.forEach((node, index) => node.props.onChangeText(values[index] ?? ''));
      render();
    },
    press() {
      this.field('Button').onPress();
      render();
    },
    async flush() {
      await new Promise((resolve) => setImmediate(resolve));
      render();
    },
    unmount() {
      for (const store of stores.values()) for (const entry of store) entry?.cleanup?.();
    },
  };
}

for (const email of ['', 'invalid']) {
  test('BF-098: invalid request email stays local', async () => {
    const form = harness();
    form.fill(email);
    form.press();
    await form.flush();
    assert(form.field('Input').error);
    assert.equal(form.calls.length, 0);
  });
}

test('BF-098: request trims email, prevents duplicate submit and reports only generic success', async () => {
  let finish;
  const form = harness('RecoveryRequestForm', {
    requestPasswordRecovery: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  form.fill('  Synthetic@example.test  ');
  form.press();
  form.press();
  form.field('Input').onSubmitEditing();
  await form.flush();
  assert.equal(form.calls.length, 1);
  assert.deepEqual(form.calls[0], {
    method: 'requestPasswordRecovery',
    args: [{ email: 'Synthetic@example.test' }],
  });
  assert.equal(form.field('Button').loading, true);
  assert.equal(form.field('Input').disabled, true);
  finish({ data: {}, error: null });
  await form.flush();
  assert.equal(
    form.text(),
    'Si existe una cuenta asociada a ese correo, recibirás instrucciones para restablecer tu contraseña.',
  );
  assert.equal(form.field('Text').role, 'status');
  assert.equal(form.field('Button').loading, false);
});

test('BF-098: request failure is accessible, safe and retryable', async () => {
  const form = harness('RecoveryRequestForm', {
    requestPasswordRecovery: async () => ({
      data: null,
      error: {
        code: 'NETWORK_ERROR',
        message: 'No se pudo conectar con el servicio. Inténtalo nuevamente.',
        metadata: 'synthetic-private',
      },
    }),
  });
  form.fill('synthetic@example.test');
  form.press();
  await form.flush();
  assert.match(form.text(), /No se pudo conectar/);
  assert(!form.text().includes('synthetic-private'));
  assert.equal(form.field('Text').role, 'alert');
  assert.equal(form.field('Button').loading, false);
  form.press();
  await form.flush();
  assert.equal(form.calls.length, 2);
});

for (const [password, confirmation, index] of [
  ['short', 'short', 0],
  ['sixsix', 'sixsix ', 1],
]) {
  test('BF-098: reset rejects short passwords and nonexact confirmation without Auth', async () => {
    const form = harness('ResetPasswordForm');
    form.fill(password, confirmation);
    form.press();
    await form.flush();
    assert(form.fields('PasswordInput')[index].error);
    assert.equal(form.calls.length, 0);
  });
}

test('BF-098: reset forwards exact whitespace/Unicode once, clears form values and logs out locally through Auth', async () => {
  let finish;
  const form = harness('ResetPasswordForm', {
    updatePassword: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const password = '  Sÿnthetic 字  ';
  form.fill(password, password);
  form.press();
  form.press();
  form.fields('PasswordInput')[1].onSubmitEditing();
  await form.flush();
  assert.equal(form.calls.length, 1);
  assert.deepEqual(form.calls[0], { method: 'updatePassword', args: [{ password }] });
  assert.equal(form.field('Button').loading, true);
  assert(form.fields('PasswordInput').every((field) => field.disabled));
  finish({ data: { user: {} }, error: null });
  await form.flush();
  assert.deepEqual(
    form.calls.map((call) => call.method),
    ['updatePassword', 'signOut'],
  );
  assert.equal(form.fields('PasswordInput').length, 0);
  assert.match(form.text(), /Tu contraseña fue actualizada/);
  assert(!form.text().includes(password));
});

test('BF-098: password changed plus logout failure preserves success and retries only logout', async () => {
  let attempts = 0;
  const form = harness('ResetPasswordForm', {
    signOut: async () =>
      ++attempts === 1
        ? { data: null, error: { code: 'NETWORK_ERROR', message: 'Synthetic normalized failure' } }
        : { data: null, error: null },
  });
  form.fill('synthetic-password', 'synthetic-password');
  form.press();
  await form.flush();
  assert.match(form.text(), /contraseña fue actualizada/);
  assert.match(form.text(), /no se pudo cerrar la sesión/);
  assert.equal(form.field('Button').label, 'Reintentar cierre de sesión');
  assert.equal(form.fields('PasswordInput').length, 0);
  form.press();
  form.press();
  await form.flush();
  assert.deepEqual(
    form.calls.map((call) => call.method),
    ['updatePassword', 'signOut', 'signOut'],
  );
  assert(!form.text().includes('no se pudo cerrar'));
});

test('BF-098: password update failure retains editable form and never logs out', async () => {
  const form = harness('ResetPasswordForm', {
    updatePassword: async () => ({
      data: null,
      error: {
        code: 'UNKNOWN_ERROR',
        message: 'No se pudo completar la operación. Inténtalo nuevamente.',
      },
    }),
  });
  form.fill('synthetic-password', 'synthetic-password');
  form.press();
  await form.flush();
  assert.equal(form.calls.length, 1);
  assert.match(form.text(), /No se pudo completar/);
  assert.equal(form.fields('PasswordInput').length, 2);
  assert.equal(form.field('Button').loading, false);
});

test('BF-098: normal authenticated session cannot render or submit reset', () => {
  const form = harness('ResetPasswordForm', {}, 'authenticated');
  assert.equal(form.field('Button'), undefined);
  assert.equal(form.fields('PasswordInput').length, 0);
  assert.equal(form.calls.length, 0);
});

test('BF-098: late password completion after unmount does not start another operation', async () => {
  let finish;
  const form = harness('ResetPasswordForm', {
    updatePassword: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  form.fill('synthetic-password', 'synthetic-password');
  form.press();
  await form.flush();
  form.unmount();
  finish({ data: {}, error: null });
  await form.flush();
  assert.equal(form.calls.length, 1);
});

function renderRecovery(filename, status = 'unauthenticated') {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = (name) => {
      if (name === 'react-native') return require('react-native-web');
      if (name === 'react-native-safe-area-context')
        return { SafeAreaView: require('react-native-web').View };
      if (name === '@/features/auth/context/AuthContext') return { useAuth: () => ({ status }) };
      if (name.endsWith('/authService'))
        return {
          authService: new Proxy({}, { get: () => () => assert.fail('No Auth on render') }),
        };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/')
          ? path.join(root, 'src', name.slice(2))
          : path.resolve(path.dirname(file), name);
        return load(['.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find(fs.existsSync));
      }
      return require(name);
    };
    vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: file })(
      localRequire,
      module,
      module.exports,
    );
    cache.set(file, module.exports);
    return module.exports;
  }
  return renderToStaticMarkup(React.createElement(load(path.join(root, filename)).default));
}

test('BF-098: real Web UI renders request and reset with shared accessible controls and Inter', () => {
  const request = renderRecovery('src/app/(auth)/forgot-password.tsx');
  assert.match(request, /aria-label="Correo electrónico"/);
  assert.match(request, /Enviar instrucciones/);
  const reset = renderRecovery('src/app/reset-password.tsx', 'recovering');
  assert.equal((reset.match(/type="password"/g) ?? []).length, 2);
  assert.match(reset, /aria-label="Nueva contraseña"/);
  assert.match(reset, /aria-label="Confirmar contraseña"/);
  assert.match(reset, /Guardar contraseña/);
  assert.match(require('react-native-web').StyleSheet.getSheet().textContent, /Inter_400Regular/);
});

function callbackHarness(code, operation) {
  let failed = false;
  let setup;
  let cleanup;
  let calls = 0;
  let writes = 0;
  const module = { exports: {} };
  const filename = path.join(root, 'src/features/auth/screens/RecoveryCallbackScreen.tsx');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const localRequire = (name) => {
    if (name === 'react')
      return {
        useState: () => [
          failed,
          (next) => {
            failed = next;
            writes++;
          },
        ],
        useEffect: (effect) => {
          setup = effect;
        },
      };
    if (name === 'expo-router') return { useLocalSearchParams: () => ({ code, type: 'recovery' }) };
    if (name === '@/components/ui')
      return { ErrorState: 'ErrorState', LoadingState: 'LoadingState' };
    if (name.endsWith('/RecoveryLayout')) return { RecoveryLayout: 'RecoveryLayout' };
    if (name.endsWith('/RecoveryRequestForm'))
      return { RecoveryRequestForm: 'RecoveryRequestForm' };
    if (name.endsWith('/authService'))
      return {
        authService: {
          completePasswordRecovery: (value) => {
            calls++;
            assert.deepEqual(value, { code });
            return operation();
          },
        },
      };
    assert.equal(name, 'react/jsx-runtime');
    return require(name);
  };
  vm.runInThisContext('(function(require,module,exports){' + compiled + '\n})', { filename })(
    localRequire,
    module,
    module.exports,
  );
  const render = () => module.exports.RecoveryCallbackScreen();
  render();
  cleanup = setup();
  return { render, calls: () => calls, writes: () => writes, unmount: () => cleanup?.() };
}

for (const code of [undefined, '', ['synthetic-one', 'synthetic-two']]) {
  test('BF-098: malformed callback never reaches Auth and offers another request', () => {
    const h = callbackHarness(code, () => assert.fail('No exchange for malformed callbacks'));
    const text = JSON.stringify(h.render());
    assert(text.includes('ErrorState'));
    assert(text.includes('RecoveryRequestForm'));
    assert.equal(h.calls(), 0);
  });
}

test('BF-098: invalid SDK callback displays only safe failure and offers request even with an existing normal session', async () => {
  const h = callbackHarness('synthetic-code', async () => ({
    data: null,
    error: { code: 'UNKNOWN_ERROR', message: 'Synthetic details must not be rendered' },
  }));
  assert(JSON.stringify(h.render()).includes('LoadingState'));
  await new Promise((resolve) => setImmediate(resolve));
  const rendered = JSON.stringify(h.render());
  assert(rendered.includes('ErrorState'));
  assert(rendered.includes('RecoveryRequestForm'));
  assert(!rendered.includes('Synthetic details'));
  assert(!rendered.includes('synthetic-code'));
  assert.equal(h.calls(), 1);
});

test('BF-098: callback cleanup ignores late errors and never updates an unmounted screen', async () => {
  let finish;
  const h = callbackHarness(
    'synthetic-code',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  h.unmount();
  const writes = h.writes();
  finish({ data: null, error: { code: 'UNKNOWN_ERROR', message: 'Synthetic safe error' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.writes(), writes);
});
