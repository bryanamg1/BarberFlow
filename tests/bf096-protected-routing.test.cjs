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
const routerRoot = path.join(root, 'node_modules/expo-router/build');
const navigatorFile = path.join(root, 'src/features/auth/routing/AuthNavigator.tsx');
const initial = { status: 'initializing', session: null, user: null, error: null };
const absent = { ...initial, status: 'unauthenticated' };
const session = { user: { id: 'synthetic-user' } };
const present = { status: 'authenticated', session, user: session.user, error: null };
const failed = {
  ...initial,
  status: 'error',
  error: { code: 'NETWORK_ERROR', message: 'No se pudo conectar con el servicio.' },
};

function compile(filename, localRequire) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    localRequire,
    module,
    module.exports,
  );
  return module.exports;
}

// Run the installed Expo Router recognizers/filter, stubbing only unrelated native integrations.
// Do not replace the protected-screen filtering algorithm with a hand-written test oracle.
function installedRouting() {
  const Group = function Group() {};
  const protectedModule = compile(path.join(routerRoot, 'views/Protected.js'), (name) => {
    if (name === '../primitives') return { Group };
    assert.equal(name, 'react');
    return React;
  });
  const screenModule = compile(path.join(routerRoot, 'views/Screen.js'), (name) =>
    name === 'react' ? React : {},
  );
  const layoutModule = compile(path.join(routerRoot, 'layouts/withLayoutContext.js'), (name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === '../views/Protected') return protectedModule;
    if (name === '../views/Screen') return screenModule;
    if (name === '../native-tabs/NativeTabTrigger') return { isNativeTabTrigger: () => false };
    return {};
  });
  const Stack = Object.assign(function Stack() {}, {
    Screen: screenModule.Screen,
    Protected: protectedModule.Protected,
  });
  function filter(tree) {
    let filtered;
    function Probe() {
      filtered = layoutModule.useFilterScreenChildren(tree.props.children);
      return null;
    }
    renderToStaticMarkup(React.createElement(Probe));
    return filtered;
  }
  const { StackRouter } = require(path.join(routerRoot, 'react-navigation/routers/StackRouter.js'));
  // The actual root Stack has no initialRouteName prop: route settings feed linking/sorting,
  // while this router chooses the first screen remaining after protected-screen exclusion.
  return { Stack, filter, router: StackRouter({}) };
}

function boundary(start = initial, realFeedback = false) {
  let auth = start;
  let pathname = '/';
  const routing = installedRouting();
  const cache = new Map();
  const native = realFeedback
    ? require('react-native-web')
    : {
        StyleSheet: { create: (styles) => styles },
        Platform: { OS: 'web', select: (values) => values.web ?? values.default },
      };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const loaded = compile(filename, (name) => {
      if (name === 'expo-router') return { Stack: routing.Stack, usePathname: () => pathname };
      if (name === '@/features/auth/context/AuthContext') return { useAuth: () => auth };
      if (name === 'react-native') return native;
      if (name === 'react-native-safe-area-context')
        return { SafeAreaView: realFeedback ? native.View : 'SafeAreaView' };
      if (name === '@/components/ui') {
        if (!realFeedback) return { LoadingState: 'LoadingState', ErrorState: 'ErrorState' };
        return {
          LoadingState: load(path.join(root, 'src/components/ui/LoadingState.tsx')).LoadingState,
          ErrorState: load(path.join(root, 'src/components/ui/ErrorState.tsx')).ErrorState,
        };
      }
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/')
          ? path.join(root, 'src', name.slice(2))
          : path.resolve(path.dirname(filename), name);
        const target = ['.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find(fs.existsSync);
        assert(target, `Missing allowed module ${name}`);
        // Only shared UI/theme dependencies may be resolved beyond the public Auth boundary.
        assert(
          target.startsWith(path.join(root, 'src/theme')) ||
            target.startsWith(path.join(root, 'src/components/ui')),
        );
        return load(target);
      }
      assert(['react', 'react/jsx-runtime'].includes(name), `Unexpected dependency ${name}`);
      return require(name);
    });
    cache.set(filename, loaded);
    return loaded;
  }
  const { AuthNavigator } = load(navigatorFile);
  return {
    ...routing,
    AuthNavigator,
    setAuth: (next) => {
      auth = next;
    },
    tree: () => AuthNavigator(),
    setPath: (value) => {
      pathname = value;
    },
  };
}

function options(names) {
  return { routeNames: names, routeParamList: {}, routeGetIdList: {}, routeKeyChanges: [] };
}

for (const [state, feedback] of [
  [initial, 'LoadingState'],
  [failed, 'ErrorState'],
]) {
  test(`BF-096: ${state.status} mounts only feedback, never private/login navigation`, () => {
    const guard = boundary(state);
    const tree = guard.tree();
    assert.equal(tree.type, 'SafeAreaView');
    assert.equal(tree.props.style.flex, 1);
    assert.equal(tree.props.children.type, feedback);
    assert.equal(tree.props.children.props.onRetry, undefined);
    assert.equal(tree.props.children.props.children, undefined);
    if (state.status === 'error')
      assert.equal(tree.props.children.props.message, failed.error.message);
  });
}

for (const [state, allowed, denied] of [
  [absent, '(auth)', '(app)'],
  [present, '(app)', '(auth)'],
]) {
  test(`BF-096: ${state.status} enables exactly ${allowed} and excludes ${denied}`, () => {
    const guard = boundary(state);
    const tree = guard.tree();
    assert.equal(tree.type, guard.Stack);
    assert.deepEqual(tree.props.screenOptions, { headerShown: false });
    assert.equal(tree.props.initialRouteName, undefined);
    const filtered = guard.filter(tree);
    assert.deepEqual(
      filtered.screens.map((screen) => screen.name),
      [allowed, 'auth/recovery'],
    );
    assert.deepEqual([...filtered.protectedScreens], [denied, 'reset-password']);
    assert.equal(filtered.children.length, 0);
    const nav = guard.router.getInitialState(options([allowed]));
    assert.equal(nav.routes[nav.index].name, allowed);
    assert.equal(
      guard.router.getStateForAction(
        nav,
        {
          type: 'NAVIGATE',
          payload: { name: denied },
        },
        options([allowed]),
      ),
      null,
      'Denied navigation cannot enter the other group',
    );
  });
}

test('BF-096: denied private deep link falls back to the public group, not private history', () => {
  const guard = boundary(absent);
  const nav = guard.router.getRehydratedState(
    {
      stale: true,
      index: 0,
      routes: [{ name: '(app)', state: { routes: [{ name: 'sales/[id]' }] } }],
    },
    options(guard.filter(guard.tree()).screens.map((screen) => screen.name)),
  );
  assert.deepEqual(
    nav.routes.map((route) => route.name),
    ['(auth)'],
  );
});

test('BF-096: unauthenticated login stays public; authenticated login falls back to app', () => {
  const guard = boundary(present);
  const nav = guard.router.getRehydratedState(
    {
      stale: true,
      index: 0,
      routes: [{ name: '(auth)', state: { routes: [{ name: 'login' }] } }],
    },
    options(guard.filter(guard.tree()).screens.map((screen) => screen.name)),
  );
  assert.deepEqual(
    nav.routes.map((route) => route.name),
    ['(app)'],
  );
  guard.setAuth(absent);
  const publicNav = guard.router.getInitialState(options(['(auth)']));
  assert.equal(publicNav.routes[publicNav.index].name, '(auth)');
});

for (const [before, after, destination] of [
  [absent, present, '(app)'],
  [present, absent, '(auth)'],
]) {
  test(`BF-096: ${before.status} -> ${after.status} removes inaccessible history without loops`, () => {
    const guard = boundary(before);
    const names = () => guard.filter(guard.tree()).screens.map((screen) => screen.name);
    let nav = guard.router.getInitialState(options(names()));
    const previous = nav.routes[0].name;
    guard.setAuth(after);
    nav = guard.router.getStateForRouteNamesChange(nav, options(names()));
    assert.deepEqual(
      nav.routes.map((route) => route.name),
      [destination],
    );
    assert(!nav.routes.some((route) => route.name === previous));
    assert.equal(guard.router.getStateForAction(nav, { type: 'GO_BACK' }, options(names())), null);
    const stable = guard.router.getStateForRouteNamesChange(nav, options(names()));
    assert.deepEqual(stable.routes, nav.routes, 'Settled guard does not alternate destinations');
  });
}

for (const change of ['TOKEN_REFRESHED', 'USER_UPDATED']) {
  test(`BF-096: resulting ${change} session keeps private navigator and route keys`, () => {
    const guard = boundary(present);
    const before = guard.tree();
    const nav = guard.router.getInitialState(options(['(app)']));
    guard.setAuth({ ...present, session: { user: { id: 'replacement-user' } } });
    const after = guard.tree();
    assert.equal(after.type, before.type);
    assert.equal(after.key, before.key);
    assert.deepEqual(after.props, before.props);
    const stable = guard.router.getStateForRouteNamesChange(nav, options(['(app)']));
    assert.deepEqual(stable.routes, nav.routes);
  });
}

test('BF-096: an Auth error hides a previously authenticated navigator and later Auth updates resolve it', () => {
  const guard = boundary(present);
  assert.equal(guard.tree().type, guard.Stack);
  guard.setAuth(failed);
  assert.equal(guard.tree().props.children.type, 'ErrorState');
  guard.setAuth(absent);
  assert.deepEqual(
    guard.filter(guard.tree()).screens.map((screen) => screen.name),
    ['(auth)', 'auth/recovery'],
  );
});

test('BF-096: real React/Web feedback exposes loading and safe error, without login, data or retry', () => {
  const guard = boundary(initial, true);
  const render = () => renderToStaticMarkup(React.createElement(guard.AuthNavigator));
  const loading = render();
  assert.match(loading, /role="progressbar"/);
  assert.match(loading, /Cargando sesión/);
  guard.setAuth(failed);
  const error = render();
  assert.match(error, /role="alert"/);
  assert(error.includes(failed.error.message));
  for (const html of [loading, error]) {
    assert(!html.includes('<input'));
    assert(!html.includes('<button'));
    assert(!html.includes('NETWORK_ERROR'));
    assert(!html.includes('synthetic-user'));
  }
});

test('BF-098: recovering permits only reset and denies private, public login and callback history', () => {
  const guard = boundary({ ...present, status: 'recovering' });
  const filtered = guard.filter(guard.tree());
  assert.deepEqual(
    filtered.screens.map((screen) => screen.name),
    ['reset-password'],
  );
  const names = options(['reset-password']);
  const nav = guard.router.getInitialState(names);
  for (const denied of ['(app)', '(auth)', 'auth/recovery']) {
    assert.equal(
      guard.router.getStateForAction(nav, { type: 'NAVIGATE', payload: { name: denied } }, names),
      null,
    );
  }
  guard.setAuth(absent);
  const next = guard.router.getStateForRouteNamesChange(
    nav,
    options(guard.filter(guard.tree()).screens.map((screen) => screen.name)),
  );
  assert.equal(
    next.routes[next.index].name,
    '(auth)',
    'Logout chooses login through existing guards',
  );
  assert(!next.routes.some((route) => route.name === 'reset-password'));
});

test('BF-098: unverified callback keeps a normal session outside private routes without enabling reset', () => {
  const guard = boundary(present);
  guard.setPath('/auth/recovery');
  assert.deepEqual(
    guard.filter(guard.tree()).screens.map((screen) => screen.name),
    ['auth/recovery'],
  );
});

test('BF-096: existing group initial routes prove /login and / Inicio destinations', () => {
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(read('src/app/(auth)/_layout.tsx'), /initialRouteName: 'login'/);
  assert.match(read('src/app/(app)/_layout.tsx'), /initialRouteName: '\(tabs\)'/);
  assert.match(read('src/app/(app)/(tabs)/_layout.tsx'), /initialRouteName="index"/);
  assert.match(read('src/app/(app)/(tabs)/index.tsx'), /Inicio/);
  assert.match(read('src/app/(auth)/login.tsx'), /LoginScreen as default/);
});

test('BF-096: login presentation and service do not own a competing navigation mechanism', () => {
  for (const file of [
    'src/features/auth/components/LoginForm.tsx',
    'src/features/auth/screens/LoginScreen.tsx',
    'src/features/auth/services/authService.ts',
  ]) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    if (!file.includes('/screens/')) assert(!source.includes('expo-router'));
    assert(!/router\.(replace|push|navigate)/.test(source));
  }
});
