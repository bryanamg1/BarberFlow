/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const React = require('react'),
  ts = require('typescript');
const { getExactRoutes } = require('expo-router/build/getRoutes');
const { getReactNavigationConfig } = require('expo-router/build/getReactNavigationConfig');
const { StackRouter } = require('expo-router/build/react-navigation/routers/StackRouter');
const {
  validatePathConfig,
} = require('expo-router/build/react-navigation/core/validatePathConfig');
const app = path.join(__dirname, '../src/app');
function compile(filename, requireModule) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    requireModule,
    module,
    module.exports,
  );
  return module.exports;
}
const Stack = Object.assign(function Stack() {}, { Screen: function Screen() {} });
function loadLayout(file) {
  return compile(path.join(app, file), (name) => {
    if (name === 'expo-router') return { Stack };
    if (name === '@/theme')
      return {
        theme: {
          colors: { surface: 'surface', textPrimary: 'text', background: 'background' },
          typography: { headingSm: {} },
        },
      };
    assert.equal(name, 'react/jsx-runtime');
    return require(name);
  });
}
const layout = loadLayout('(app)/_layout.tsx');
const element = layout.default();
const screens = React.Children.toArray(element.props.children).map((child) => child.props);
// Read only actual layout initial-route metadata. No feature/provider is mocked as a routed result.
function initialRoute(file) {
  const ast = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  for (const statement of ast.statements)
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations) {
        if (
          declaration.name.getText(ast) !== 'unstable_settings' ||
          !declaration.initializer ||
          !ts.isObjectLiteralExpression(declaration.initializer)
        )
          continue;
        const property = declaration.initializer.properties.find(
          (p) => p.name?.getText(ast) === 'initialRouteName',
        );
        if (
          property &&
          ts.isPropertyAssignment(property) &&
          ts.isStringLiteral(property.initializer)
        )
          return property.initializer.text;
      }
}
const keys = fs
  .readdirSync(app, { recursive: true })
  .filter((file) => /\.tsx$/.test(file))
  .map((file) => './' + file.replaceAll(path.sep, '/'));
const context = (key) => {
  const file = path.join(app, key);
  return {
    default: () => null,
    ...(key.endsWith('_layout.tsx')
      ? { unstable_settings: { initialRouteName: initialRoute(file) } }
      : {}),
  };
};
context.keys = () => keys;
const tree = getExactRoutes(context, {
  platform: 'web',
  importMode: 'sync',
  ignoreEntryPoints: true,
});
const appTree = tree.children.find((route) => route.route === '(app)');
const config = getReactNavigationConfig(tree, true);
// Use the installed Expo path parser. Redirect only its native barrel to the real pure validator.
const parserFile = require.resolve('expo-router/build/fork/getStateFromPath');
const localRequire = createRequire(parserFile);
const { getStateFromPath } = compile(parserFile, (name) =>
  name === '../react-navigation/native' ? { validatePathConfig } : localRequire(name),
);
const leaf = (state) => {
  let route = state.routes[state.index ?? state.routes.length - 1];
  while (route.state)
    route = route.state.routes[route.state.index ?? route.state.routes.length - 1];
  return route;
};

test('BF283 exact filesystem stack coverage: every existing app screen registered once and no invented routes', () => {
  const registered = screens.map((s) => s.name),
    discovered = appTree.children.map((route) => route.route);
  assert.equal(new Set(registered).size, registered.length);
  assert.deepEqual([...registered].sort(), [...discovered].sort());
  assert.equal(element.type, Stack);
  assert.equal(layout.unstable_settings.initialRouteName, '(tabs)');
  assert.equal(screens.find((s) => s.name === '(tabs)').options.headerShown, false);
  for (const screen of screens.filter((s) => s.name !== '(tabs)'))
    assert(screen.options.title && screen.options.title.trim());
});
test('BF283 five original tab roots unchanged, finance remains tab-owned and histories remain stack-owned', () => {
  const tabs = appTree.children.find((route) => route.route === '(tabs)');
  assert.deepEqual(tabs.children.map((route) => route.route).sort(), [
    'agenda',
    'clients',
    'finances',
    'index',
    'quick-action',
  ]);
  for (const group of ['sales', 'purchases', 'expenses'])
    assert(!tabs.children.some((route) => route.route.startsWith(group)));
  assert(!screens.some((s) => s.name === 'finances' || s.name === 'finances/index'));
  assert.equal(keys.filter((key) => key.includes('/_layout.tsx')).length, 4);
});
const added = [
  ['appointments/[id]/edit', 'Editar cita'],
  ['products/[id]/edit', 'Editar producto'],
  ['products/categories/index', 'Categorías'],
  ['products/categories/new', 'Crear categoría'],
  ['products/categories/[id]/edit', 'Editar categoría'],
  ['purchases/new', 'Nueva compra'],
  ['sales/index', 'Historial de ventas'],
];
for (const [name, title] of added)
  test(`BF283 canonical header ${name}`, () => {
    const screen = screens.find((s) => s.name === name);
    assert(screen);
    assert.equal(screen.options.title, title);
    assert.equal(screen.options.headerShown, undefined);
    assert.equal(screen.options.presentation, undefined);
  });
test('BF283 screen registration adds no business/auth/fetch/back override or modal presentation', () => {
  const source = fs.readFileSync(path.join(app, '(app)/_layout.tsx'), 'utf8');
  assert(
    !/useAuth|useBusiness|supabase|useQuery|fetch\(|Redirect|router\.|beforeRemove|BackHandler|presentation:|headerLeft:|getId=/.test(
      source,
    ),
  );
  assert.equal(element.props.screenOptions.presentation, undefined);
  assert.equal(element.props.initialRouteName, undefined);
});
const direct = [
  ['/', 'index'],
  ['/agenda', 'agenda'],
  ['/clients', 'clients'],
  ['/finances', 'finances'],
  ['/appointments/new', 'appointments/new'],
  ['/appointments/fixture', 'appointments/[id]'],
  ['/appointments/fixture/edit', 'appointments/[id]/edit'],
  ['/clients/new', 'clients/new'],
  ['/clients/fixture', 'clients/[id]'],
  ['/clients/fixture/edit', 'clients/[id]/edit'],
  ['/products', 'products/index'],
  ['/products/categories', 'products/categories/index'],
  ['/products/categories/new', 'products/categories/new'],
  ['/products/categories/fixture/edit', 'products/categories/[id]/edit'],
  ['/products/new', 'products/new'],
  ['/products/fixture', 'products/[id]'],
  ['/products/fixture/edit', 'products/[id]/edit'],
  ['/products/fixture/stock-adjustment', 'products/[id]/stock-adjustment'],
  ['/sales', 'sales/index'],
  ['/sales/new', 'sales/new'],
  ['/sales/fixture', 'sales/[id]'],
  ['/purchases', 'purchases/index'],
  ['/purchases/new', 'purchases/new'],
  ['/purchases/fixture', 'purchases/[id]'],
  ['/expenses', 'expenses/index'],
  ['/expenses/new', 'expenses/new'],
  ['/expenses/fixture/edit', 'expenses/[id]/edit'],
  ['/expenses/categories', 'expenses/categories/index'],
  ['/expenses/categories/new', 'expenses/categories/new'],
  ['/expenses/categories/fixture/edit', 'expenses/categories/[id]/edit'],
  ['/services', 'services/index'],
  ['/services/new', 'services/new'],
  ['/services/fixture/edit', 'services/[id]/edit'],
  ['/settings', 'settings/index'],
  ['/settings/profile', 'settings/profile'],
  ['/settings/appearance', 'settings/appearance'],
  ['/settings/notifications', 'settings/notifications'],
  ['/settings/payment-methods', 'settings/payment-methods'],
  ['/business/settings', 'business/settings'],
  ['/business/hours', 'business/hours'],
  ['/login', 'login'],
  ['/forgot-password', 'forgot-password'],
  ['/auth/recovery?code=synthetic-test-only', 'auth/recovery'],
  ['/reset-password', 'reset-password'],
];
for (const [url, name] of direct)
  test(`BF283 installed Expo parser direct URL/reload ${url}`, () => {
    const state = getStateFromPath(url, config);
    assert(state, url);
    assert.equal(leaf(state).name, name);
    assert.deepEqual(getStateFromPath(url, config), state);
    if (name.includes('[id]')) assert.equal(leaf(state).params.id, 'fixture');
  });
for (const name of [
  'sales/index',
  'sales/new',
  'sales/[id]',
  'appointments/[id]/edit',
  'clients/[id]/edit',
  'products/[id]/edit',
  'purchases/new',
  'expenses/[id]/edit',
])
  test(`BF283 installed StackRouter normal push/back ${name}`, () => {
    const router = StackRouter({ initialRouteName: '(tabs)' }),
      options = { routeNames: screens.map((s) => s.name), routeParamList: {}, routeGetIdList: {} };
    const initial = router.getInitialState(options);
    let state = router.getStateForAction(
      initial,
      { type: 'PUSH', payload: { name, params: { id: 'fixture' } } },
      options,
    );
    assert.equal(state.routes[state.index].name, name);
    state = router.getStateForAction(state, { type: 'GO_BACK' }, options);
    assert.equal(state.routes[state.index].name, '(tabs)');
    // Direct entry is represented by real linking metadata, not a custom fallback/redirect.
    assert.equal(appTree.initialRouteName, '(tabs)');
  });
test('BF283 all five approved quick-action URLs remain real stack leaves', () => {
  for (const url of [
    '/appointments/new',
    '/clients/new',
    '/sales/new',
    '/expenses/new',
    '/purchases/new',
  ]) {
    const state = getStateFromPath(url, config);
    assert(state);
    assert(screens.some((screen) => screen.name === leaf(state).name));
  }
});
