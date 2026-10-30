/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const React = require('react');
const ts = require('typescript');
const { getExactRoutes } = require('expo-router/build/getRoutes');
const { TabRouter } = require('expo-router/build/react-navigation/routers/TabRouter');
const { StackRouter } = require('expo-router/build/react-navigation/routers/StackRouter');

const root = path.resolve(__dirname, '..');
const appRoot = path.join(root, 'src/app');
const expectedTabs = [
  ['index', 'Inicio'],
  ['agenda', 'Agenda'],
  ['quick-action', 'Quick Action'],
  ['clients', 'Clientes'],
  ['finances', 'Finanzas'],
];

function layout(filename) {
  const Tabs = Object.assign(function Tabs() {}, { Screen: function Screen() {} });
  function load(file) {
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
      (name) => {
        if (name === 'expo-router') return { Tabs, Stack: Tabs, usePathname: () => '/agenda' };
        if (name === 'react')
          return { ...React, useState: (initial) => [initial, () => undefined] };
        // This test discovers real routes/configuration, not host lifecycle behavior.
        // BF281's component/Web tests exercise those hooks without this boundary stub.
        if (name === '@/features/appointments/hooks/useAppointmentLifecycle')
          return {
            useAppointmentLifecycle: () => ({
              scope: { role: 'OWNER' },
              epoch: Symbol(),
              isCurrent: () => true,
            }),
          };
        if (name === '@/features/business/context/BusinessContext')
          return { useBusiness: () => ({ status: 'success', isFetching: false }) };
        if (name === 'expo-symbols') return { SymbolView: function SymbolView() {} };
        if (name === 'react-native')
          return {
            View: function View() {},
            StyleSheet: { create: (styles) => styles },
            Platform: { OS: 'web', select: (values) => values.web ?? values.default },
          };
        if (name === 'react-native-safe-area-context')
          return { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
        if (name === '@/components/ui') return { IconButton: function IconButton() {} };
        if (name.startsWith('@/') || name.startsWith('.')) {
          const base = name.startsWith('@/')
            ? path.join(root, 'src', name.slice(2))
            : path.resolve(path.dirname(file), name);
          const target = ['.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find(fs.existsSync);
          assert(
            target &&
              (target.startsWith(path.join(root, 'src/theme')) ||
                target.startsWith(path.join(root, 'src/features/navigation'))),
          );
          return load(target);
        }
        assert.equal(name, 'react/jsx-runtime');
        return require(name);
      },
      module,
      module.exports,
    );
    return module.exports;
  }
  return load(filename).default();
}

function routeTree() {
  // Discover the actual filesystem with the installed Expo Router, not a hand-built route list.
  const keys = fs
    .readdirSync(appRoot, { recursive: true })
    .filter((file) => /\.[tj]sx?$/.test(file))
    .map((file) => './' + file.replaceAll(path.sep, '/'));
  const context = () => ({ default: () => null });
  context.keys = () => keys;
  return getExactRoutes(context, {
    platform: 'web',
    importMode: 'async',
    ignoreEntryPoints: true,
  });
}

test('BF-097/BF-280 regression: four destinations, center control and protected Settings preserve the real route tree', () => {
  const tree = layout(path.join(appRoot, '(app)/(tabs)/_layout.tsx'));
  const screens = React.Children.toArray(tree.props.children).map((child) => child.props);
  assert.deepEqual(
    screens.map((screen) => [screen.name, screen.options.title]),
    expectedTabs,
  );
  assert.notEqual(tree.props.screenOptions?.tabBarShowLabel, false);
  assert.notEqual(tree.props.screenOptions?.tabBarStyle?.display, 'none');
  const app = routeTree().children.find((route) => route.route === '(app)');
  const tabs = app.children.find((route) => route.route === '(tabs)');
  const names = screens.map((screen) => screen.name);
  const options = { routeNames: names, routeParamList: {}, routeGetIdList: {} };
  const router = TabRouter({ initialRouteName: tree.props.initialRouteName });
  let state = router.getInitialState(options);
  assert.equal(state.routes[state.index].name, 'index');
  for (const screen of screens) {
    assert(
      tabs.children.some((route) => route.route === screen.name),
      screen.name,
    );
    assert.notEqual(screen.options.href, null);
    if (screen.name === 'quick-action') {
      assert.equal(typeof screen.options.tabBarButton, 'function');
      assert.equal(screen.options.tabBarButton().props.open, false);
      let prevented = false;
      screen.listeners.tabPress({
        preventDefault: () => {
          prevented = true;
        },
      });
      assert.equal(prevented, true);
      continue; // The legacy file is registered, but the control never jumps to it.
    }
    assert.equal(screen.options.tabBarButton, undefined);
    assert.notEqual(screen.options.tabBarShowLabel, false);
    assert.notEqual(screen.options.tabBarItemStyle?.display, 'none');
    state = router.getStateForAction(
      state,
      { type: 'JUMP_TO', payload: { name: screen.name } },
      options,
    );
    assert(state, `Tab press must reach ${screen.options.title}`);
    assert.equal(state.routes[state.index].name, screen.name);
  }
  assert.equal(tabs.children.length, 5);
  assert(!tabs.children.some((route) => route.route === 'settings/index'));
  const settings = app.children.find((route) => route.route === 'settings/index');
  assert.equal(settings.contextKey, './(app)/settings/index.tsx');
});

test('BF-097 regression: navigation exposes Settings without competing Auth or storage logic', () => {
  for (const file of ['(app)/_layout.tsx', '(app)/(tabs)/_layout.tsx']) {
    const source = fs.readFileSync(path.join(appRoot, file), 'utf8');
    assert(
      !/router\.(replace|push|navigate)|setSession|localStorage|AsyncStorage|SecureStore/.test(
        source,
      ),
    );
    assert(!/authService|authRepository|supabase/.test(source));
  }
  const stack = layout(path.join(appRoot, '(app)/_layout.tsx'));
  assert(
    React.Children.toArray(stack.props.children).some(
      (child) => child.props.name === 'settings/index',
    ),
  );
});

for (const existingSettings of [true, false]) {
  test(`BF280 Router POP_TO preserves one Settings entry, existing=${existingSettings}`, () => {
    const router = StackRouter({ initialRouteName: '(tabs)' });
    const options = {
      routeNames: ['(tabs)', 'settings/index', 'settings/appearance'],
      routeParamList: {},
      routeGetIdList: {},
    };
    let state = router.getInitialState(options);
    if (existingSettings)
      state = router.getStateForAction(
        state,
        { type: 'PUSH', payload: { name: 'settings/index' } },
        options,
      );
    state = router.getStateForAction(
      state,
      { type: 'PUSH', payload: { name: 'settings/appearance' } },
      options,
    );
    state = router.getStateForAction(
      state,
      { type: 'POP_TO', payload: { name: 'settings/index' } },
      options,
    );
    assert(state);
    assert.deepEqual(
      state.routes.map((r) => r.name),
      ['(tabs)', 'settings/index'],
    );
    state = router.getStateForAction(state, { type: 'GO_BACK' }, options);
    assert.equal(state.routes[state.index].name, '(tabs)');
  });
}
