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
  { createRoot } = require('react-dom/client'),
  TQ = require('@tanstack/react-query');
TQ.notifyManager.setScheduler(queueMicrotask);
const cache = new Map(),
  calls = [];
const data = {
  getDashboardSummary: {
    total_revenue: '100.00',
    service_revenue: '40.00',
    product_revenue: '60.00',
    expenses: '10.00',
    merchandise_purchases: '20.00',
    profit: '-0.50',
    appointments: '2',
    active_clients: '3',
    average_ticket: null,
    products_sold: '4',
    cancellations: '0',
    no_shows: '0',
  },
  getRevenueByDay: [],
  getTopServices: [
    { service_id: 's', name: 'Corte histórico', quantity: '2', net_revenue: '40.00' },
  ],
  getTopProducts: [
    {
      product_id: 'p',
      name: 'Cera histórica',
      quantity: '1',
      net_revenue: '60.00',
      cogs: '60.50',
      gross_profit: '-0.50',
    },
  ],
  getExpenseSummary: {
    manual_total: '10.00',
    purchase_total: '20.00',
    total: '30.00',
    by_category: [],
  },
};
const service = Object.fromEntries(
  Object.entries(data).map(([name, value]) => [
    name,
    async () => {
      calls.push(name);
      return { data: value, error: null };
    },
  ]),
);
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) => {
      if (name === 'react-native') return RN;
      if (name === 'react-native-safe-area-context')
        return { SafeAreaView: ({ edges, ...props }) => React.createElement(RN.View, props) };
      if (name === 'expo-router')
        return {
          useIsFocused: () => true,
          useFocusEffect: (callback) => React.useEffect(callback, [callback]),
        };
      if (name === '@/features/auth/context/AuthContext')
        return { useAuth: () => ({ status: 'authenticated', user: { id: 'u' } }) };
      if (name === '@/features/business/context/BusinessContext')
        return {
          useBusiness: () => ({
            status: 'success',
            isFetching: false,
            data: {
              membershipId: 'm',
              role: 'OWNER',
              business: { id: 'b', timezone: 'UTC', currency_code: 'ARS' },
            },
          }),
        };
      if (name.endsWith('/services/analyticsService')) return { analyticsService: service };
      assert(!/supabase|repositories/.test(name), 'No SDK/network in screen fixture');
      if (name === '@/components/ui')
        return Object.fromEntries(
          ['EmptyState', 'ErrorState', 'LoadingState'].map((n) => [
            n,
            load(path.join(__dirname, `../src/components/ui/${n}.tsx`))[n],
          ]),
        );
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/')
          ? path.join(__dirname, '../src', name.slice(2))
          : path.resolve(path.dirname(filename), name);
        const target = ['.ts', '.tsx', '/index.ts'].map((e) => base + e).find(fs.existsSync);
        assert(target, name);
        return load(target);
      }
      return require(name);
    },
    module,
    module.exports,
  );
  return module.exports;
}
const { FinanceScreen } = load(
  path.join(__dirname, '../src/features/analytics/screens/FinanceScreen.tsx'),
);
const client = new TQ.QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  }),
  root = createRoot(document.getElementById('root'));
const button = (label) =>
  [...document.querySelectorAll('[role="button"]')].find((n) => n.textContent === label);
const flush = () =>
  React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
test('BF256 actual Web initial heading/controls/KPIs, native focus and only overview requests', async () => {
  await React.act(async () =>
    root.render(
      React.createElement(TQ.QueryClientProvider, { client }, React.createElement(FinanceScreen)),
    ),
  );
  await flush();
  assert(document.querySelector('[role="heading"]').textContent.includes('Finanzas'));
  assert.deepEqual(calls, ['getDashboardSummary', 'getRevenueByDay']);
  const period = document.querySelector('[aria-label="Período financiero"]'),
    tabs = document.querySelector('[aria-label="Sección de Finanzas"]');
  assert(period.compareDocumentPosition(tabs) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  await React.act(async () => button('Productos').focus());
  assert.equal(document.activeElement, button('Productos'));
  assert.equal(button('Resumen').getAttribute('aria-pressed'), 'true');
});
test('BF256 actual Web tab/period activation hides inactive sections and preserves MONTH', async () => {
  await React.act(async () => button('Mes').click());
  await flush();
  await React.act(async () => button('Productos').click());
  await flush();
  assert(document.querySelector('[aria-label^="Producto: Cera histórica"]'));
  assert(
    ![...document.querySelectorAll('[role="heading"]')].some((n) => n.textContent === 'Gastos'),
  );
  assert(!calls.includes('getExpenseSummary'));
  await React.act(async () => button('Gastos').click());
  await flush();
  assert(document.querySelector('[aria-label="Gastos manuales: ARS 10,00"]'));
  assert(!document.querySelector('[aria-label^="Producto: Cera histórica"]'));
  assert.equal(button('Mes').getAttribute('aria-pressed'), 'true');
});
after(async () => {
  await React.act(async () => root.unmount());
  client.clear();
  TQ.notifyManager.setScheduler(TQ.defaultScheduler);
  dom.window.close();
});
