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

const root = path.resolve(__dirname, '..');
const appRoot = path.join(root, 'src/app');
const expectedTabs = [
  ['index', 'Inicio'],
  ['agenda', 'Agenda'],
  ['quick-action', 'Quick Action'],
  ['clients', 'Clientes'],
  ['finances', 'Finanzas'],
  ['settings/index', 'Configuración'],
];

function layout(filename) {
  const Tabs = Object.assign(function Tabs() {}, { Screen: function Screen() {} });
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) => {
      if (name === 'expo-router') return { Tabs, Stack: Tabs };
      assert.equal(name, 'react/jsx-runtime');
      return require(name);
    },
    module,
    module.exports,
  );
  return module.exports.default();
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

test('BF-097 regression: all existing tabs and Settings are visible destinations in the real route tree', () => {
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
  const settings = tabs.children.find((route) => route.route === 'settings/index');
  assert.equal(settings.contextKey, './(app)/(tabs)/settings/index.tsx');
  assert(!app.children.some((route) => route.route === 'settings/index'));
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
    !React.Children.toArray(stack.props.children).some(
      (child) => child.props.name === 'settings/index',
    ),
  );
});
