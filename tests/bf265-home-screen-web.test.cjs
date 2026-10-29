/* global __dirname */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { test, after } = require('node:test'),
  ts = require('typescript'),
  { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
for (const name of [
  'HTMLElement',
  'Node',
  'Element',
  'SVGElement',
  'ShadowRoot',
  'MutationObserver',
])
  global[name] = dom.window[name];
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react'),
  RN = require('react-native-web'),
  { createRoot } = require('react-dom/client');
const sourceRoot = path.resolve(__dirname, '../src'),
  cache = new Map(),
  navigation = [],
  props = {};
let role = 'OWNER',
  summaryCalls = 0,
  nextCalls = 0;
const summary = { status: 'success', data: { total_revenue: '100.00' } },
  next = { status: 'success', data: null };
function widget(name) {
  return function Widget(p) {
    props[name] = p;
    return React.createElement(
      RN.View,
      { testID: 'widget-' + name },
      React.createElement(RN.Text, null, name),
      p.onOpen &&
        React.createElement(
          RN.Pressable,
          { role: 'button', accessibilityLabel: 'Open next', onPress: () => p.onOpen('web-id') },
          React.createElement(RN.Text, null, 'Open next'),
        ),
      p.onOpenFinances &&
        React.createElement(
          RN.Pressable,
          { role: 'button', accessibilityLabel: 'Open finances', onPress: p.onOpenFinances },
          React.createElement(RN.Text, null, 'Open finances'),
        ),
    );
  };
}
const widgets = Object.fromEntries(
  [
    'HomeKpis',
    'HomeNextAppointment',
    'HomeTodayAppointments',
    'HomeFinanceSummary',
    'HomeLowStock',
  ].map((name) => [name, widget(name)]),
);
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
    (name) => {
      if (name === 'react-native') return RN;
      if (name === 'react-native-safe-area-context')
        return { SafeAreaView: ({ edges, ...p }) => React.createElement(RN.View, p) };
      if (name === 'expo-router')
        return { router: { push: (v) => navigation.push(v) }, useIsFocused: () => true };
      if (name === '@/features/auth/context/AuthContext')
        return { useAuth: () => ({ status: 'authenticated', user: { id: 'u' } }) };
      if (name === '@/features/business/context/BusinessContext')
        return {
          useBusiness: () => ({
            status: 'success',
            isFetching: false,
            data: {
              role,
              membershipId: 'm',
              business: { id: 'b', currency_code: 'ARS', timezone: 'UTC' },
            },
          }),
        };
      if (name.endsWith('/hooks/useHomeDashboardSummary'))
        return {
          useHomeDashboardSummary: () => {
            summaryCalls++;
            return summary;
          },
        };
      if (name.endsWith('/hooks/useNextAppointment'))
        return {
          useNextAppointment: () => {
            nextCalls++;
            return next;
          },
        };
      for (const key of Object.keys(widgets))
        if (name.endsWith('/components/' + key)) return { [key]: widgets[key] };
      if (name === '@/components/ui')
        return Object.fromEntries(
          ['EmptyState', 'ErrorState', 'LoadingState'].map((key) => [
            key,
            (p) => React.createElement(RN.Text, null, p.title || p.message),
          ]),
        );
      assert(
        !/supabase|repositories|services/.test(name),
        'No transport owned by HomeScreen fixture',
      );
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/')
          ? path.join(sourceRoot, name.slice(2))
          : path.resolve(path.dirname(file), name);
        const f = ['.ts', '.tsx', '/index.ts'].map((e) => base + e).find(fs.existsSync);
        assert(f, name);
        return load(f);
      }
      return require(name);
    },
    module,
    module.exports,
  );
  return module.exports;
}
const { HomeScreen } = load(path.join(sourceRoot, 'features/analytics/screens/HomeScreen.tsx'));
for (const width of [390, 1400])
  for (const actor of ['OWNER', 'BARBER'])
    test(`BF265 Web DOM ${actor} ${width}: ordered single-column composition and host callbacks`, async () => {
      role = actor;
      summaryCalls = 0;
      nextCalls = 0;
      navigation.length = 0;
      for (const key of Object.keys(props)) delete props[key];
      Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
      const container = document.getElementById('root'),
        root = createRoot(container);
      try {
        await React.act(async () => root.render(React.createElement(HomeScreen)));
        const expected =
          actor === 'OWNER'
            ? [
                'HomeKpis',
                'HomeNextAppointment',
                'HomeTodayAppointments',
                'HomeFinanceSummary',
                'HomeLowStock',
              ]
            : ['HomeNextAppointment', 'HomeTodayAppointments', 'HomeLowStock'];
        assert.deepEqual(
          [...container.querySelectorAll('[data-testid^="widget-"]')].map((n) =>
            n.getAttribute('data-testid').replace('widget-', ''),
          ),
          expected,
        );
        assert.equal(container.querySelector('[role="heading"]').textContent, 'Inicio');
        const content = container.querySelector(
          '[data-testid="widget-HomeNextAppointment"]',
        ).parentElement;
        const style = window.getComputedStyle(content);
        assert.equal(style.maxWidth, '1200px');
        assert.equal(style.padding, '16px');
        assert.equal(style.gap, '24px');
        assert.equal(style.flexDirection, 'column');
        assert.equal(summaryCalls, 1);
        assert.equal(nextCalls, 1);
        assert.equal(props.HomeNextAppointment.result, next);
        if (actor === 'OWNER') {
          assert.equal(props.HomeKpis.result, summary);
          assert.equal(props.HomeFinanceSummary.result, summary);
          await React.act(async () =>
            container.querySelector('[aria-label="Open finances"]').click(),
          );
          assert.equal(navigation[0], '/finances');
        } else assert.equal(container.querySelector('[aria-label="Open finances"]'), null);
        await React.act(async () => container.querySelector('[aria-label="Open next"]').click());
        assert.deepEqual(navigation.at(-1), {
          pathname: '/appointments/[id]',
          params: { id: 'web-id' },
        });
      } finally {
        await React.act(async () => root.unmount());
      }
    });
after(() => dom.window.close());
