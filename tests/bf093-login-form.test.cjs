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
const success = {
  data: { user: { id: 'synthetic' }, session: { access_token: 'SECRET' } },
  error: null,
};

// Run the installed RHF hooks, Controller, resolver and schema. Only React's hook lifecycle,
// native hosts and the authService boundary are controlled; no validation or form logic is mocked.
function harness(operation = async () => success, onSuccess) {
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
      if (name.endsWith('/authService'))
        return {
          authService: {
            signInWithPassword: async (values) => {
              calls.push(values);
              return operation(values);
            },
          },
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
  const { LoginForm } = load(path.join(root, 'src/features/auth/components/LoginForm.tsx'));
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
      visit(React.createElement(LoginForm, { onSuccess }), 'form');
      effects.splice(0).forEach((run) => run());
      assert(++passes < 30, 'Render must converge');
    } while (dirty);
  }
  render();
  return {
    calls,
    field: (type) => nodes.find((node) => node.type === type).props,
    text: () =>
      nodes
        .filter((node) => node.type === 'Text')
        .map((node) => node.props.children)
        .join(' '),
    fill(email = 'owner@example.com', password = 'secret') {
      this.field('Input').onChangeText(email);
      this.field('PasswordInput').onChangeText(password);
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

test('BF-093: empty defaults, labels and email keyboard; password delegates to shared secure control', () => {
  const form = harness();
  assert.equal(form.field('Input').value, '');
  assert.equal(form.field('PasswordInput').value, '');
  assert.equal(form.field('Input').label, 'Correo electrónico');
  assert.equal(form.field('PasswordInput').label, 'Contraseña');
  assert.equal(form.field('Input').keyboardType, 'email-address');
  assert.equal(form.field('Input').autoCapitalize, 'none');
  assert.equal(form.field('Input').autoCorrect, false);
  assert.equal(form.calls.length, 0);
});

for (const [name, email, password, field, message] of [
  ['empty email', '', 'secret', 'Input', 'Ingresa tu correo electrónico.'],
  ['invalid email', 'invalid', 'secret', 'Input', 'Ingresa un correo electrónico válido.'],
  ['empty password', 'owner@example.com', '', 'PasswordInput', 'Ingresa tu contraseña.'],
]) {
  test(`BF-093: ${name} displays schema error and never calls Auth`, async () => {
    const form = harness();
    form.fill(email, password);
    form.press();
    await form.flush();
    assert.equal(form.field(field).error, message);
    assert.equal(form.calls.length, 0);
    assert.equal(form.field('Button').loading, false);
  });
}

test('BF-093: valid submit trims email only, preserves exact password, invokes callback without credentials', async () => {
  const callbackArgs = [];
  const form = harness(
    async () => success,
    (...args) => callbackArgs.push(args),
  );
  form.fill('  Owner@example.com  ', '  Sëcret\t ');
  form.press();
  await form.flush();
  assert.deepEqual(form.calls, [{ email: 'Owner@example.com', password: '  Sëcret\t ' }]);
  assert.deepEqual(callbackArgs, [[]]);
  assert.equal(form.field('Button').loading, false);
  assert(!form.text().includes('SECRET'));
});

test('BF-093: guard blocks button and keyboard duplicates during validation and pending Auth', async () => {
  let finish;
  const form = harness(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  form.fill();
  form.press();
  form.press();
  form.field('PasswordInput').onSubmitEditing();
  await form.flush();
  assert.equal(form.calls.length, 1);
  assert.equal(form.field('Button').loading, true);
  assert.equal(form.field('Input').disabled, true);
  assert.equal(form.field('PasswordInput').disabled, true);
  form.press();
  await form.flush();
  assert.equal(form.calls.length, 1);
  finish(success);
  await form.flush();
  assert.equal(form.field('Button').loading, false);
});

test('BF-093: normalized service failure is accessible, preserves edits and allows retry', async () => {
  let attempt = 0;
  const form = harness(async () =>
    ++attempt === 1
      ? {
          data: null,
          error: {
            code: 'AUTH_INVALID_CREDENTIALS',
            message: 'El correo o la contraseña son incorrectos.',
            metadata: 'PRIVATE',
          },
        }
      : success,
  );
  form.fill();
  form.press();
  await form.flush();
  assert.equal(form.text(), 'El correo o la contraseña son incorrectos.');
  assert.equal(form.field('Text').role, 'alert');
  assert.equal(form.field('Text')['aria-live'], 'assertive');
  assert.equal(form.field('PasswordInput').value, 'secret');
  assert(!form.text().includes('PRIVATE'));
  form.press();
  assert.equal(form.text(), '');
  await form.flush();
  assert.equal(form.calls.length, 2);
});

test('BF-093: unexpected rejection never renders raw details and releases loading', async () => {
  let callbacks = 0;
  const form = harness(
    async () => {
      throw new Error('PASSWORD TOKEN PRIVATE STACK');
    },
    () => callbacks++,
  );
  form.fill();
  form.press();
  await form.flush();
  assert.equal(form.text(), 'No se pudo completar la operación. Inténtalo nuevamente.');
  assert.equal(form.field('Button').loading, false);
  assert.equal(callbacks, 0);
});

test('BF-093: late success after unmount does not call consumer', async () => {
  let finish;
  let callbacks = 0;
  const form = harness(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    () => callbacks++,
  );
  form.fill();
  form.press();
  await form.flush();
  form.unmount();
  finish(success);
  await form.flush();
  assert.equal(callbacks, 0);
});

test('BF-093: real React, RHF and React Native Web render shared inputs and accessible submit', () => {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const module = { exports: {} };
    const localRequire = (name) => {
      if (name === 'react-native') return require('react-native-web');
      if (name === 'react-native-safe-area-context')
        return { SafeAreaProvider: 'div', SafeAreaView: 'div' };
      if (name.endsWith('/authService'))
        return {
          authService: { signInWithPassword: () => assert.fail('No request while rendering') },
        };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/')
          ? path.join(root, 'src', name.slice(2))
          : path.resolve(path.dirname(filename), name);
        return load(['.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find(fs.existsSync));
      }
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
  const { LoginForm } = load(path.join(root, 'src/features/auth/components/LoginForm.tsx'));
  const html = renderToStaticMarkup(React.createElement(LoginForm, {}));
  assert.match(html, /aria-label="Correo electrónico"/);
  assert.match(html, /type="password"/);
  assert.match(html, /Iniciar sesión/);
  assert.match(require('react-native-web').StyleSheet.getSheet().textContent, /Inter_400Regular/);
});
