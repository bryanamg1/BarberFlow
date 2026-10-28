/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { JSDOM } = require('jsdom');
const RN = require('react-native-web');
let width = 375;
const cache = new Map();
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) => {
      if (name === 'react-native')
        return {
          ...RN,
          useWindowDimensions: () => ({ width, height: 900, scale: 1, fontScale: 1 }),
        };
      if (name === '@/features/auth/context/AuthContext')
        return { useAuth: () => ({ status: 'authenticated', user: { id: 'synthetic-user' } }) };
      if (name === '@/features/business/context/BusinessContext')
        return {
          useBusiness: () => ({
            status: 'success',
            isFetching: false,
            data: { role: 'OWNER', business: { currency_code: 'ARS' } },
          }),
        };
      assert(
        !/supabase|repositories|services\/|hooks\/|query|catalog/i.test(name),
        `No data dependency: ${name}`,
      );
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/')
          ? path.join(__dirname, '../src', name.slice(2))
          : path.resolve(path.dirname(filename), name);
        const target = ['.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find(fs.existsSync);
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
const { FinanceServicesPanel } = load(
  path.join(__dirname, '../src/features/analytics/components/FinanceServicesPanel.tsx'),
);
const { FinanceProductsExpensesPanel } = load(
  path.join(__dirname, '../src/features/analytics/components/FinanceProductsExpensesPanel.tsx'),
);
function renderPanels() {
  return renderToStaticMarkup(
    React.createElement(
      RN.View,
      null,
      React.createElement(FinanceServicesPanel, {
        result: {
          status: 'success',
          data: [
            {
              service_id: 'hidden-service-key',
              name: 'Corte clásico',
              quantity: '900719925474099312345',
              net_revenue: '1234.50',
            },
          ],
        },
      }),
      React.createElement(FinanceProductsExpensesPanel, {
        productsResult: {
          status: 'success',
          data: [
            {
              product_id: 'hidden-product-key',
              name: 'Cera histórica',
              quantity: '2',
              net_revenue: '100.00',
              cogs: '100.50',
              gross_profit: '-0.50',
            },
          ],
        },
        expensesResult: {
          status: 'success',
          data: { manual_total: '0.00', purchase_total: '0.00', total: '0.00', by_category: [] },
        },
      }),
    ),
  );
}
test('BF254/255 actual RNWeb SSR has exact accessible groups, hidden identities and signed/zero amounts at mobile/desktop', () => {
  for (width of [375, 1440]) {
    const html = renderPanels();
    const dom = new JSDOM(html);
    const labels = [...dom.window.document.querySelectorAll('[role="group"]')].map((n) =>
      n.getAttribute('aria-label'),
    );
    assert.equal(labels.length, 5);
    assert.match(labels[0], /Corte clásico.*Cantidad: 900719925474099312345.*ARS\s1\.234,50/);
    assert.match(
      labels[1],
      /Producto: Cera histórica.*Costo: ARS\s100,50.*Ganancia bruta: -ARS\s0,50/,
    );
    assert.deepEqual(labels.slice(2), [
      'Gastos manuales: ARS 0,00',
      'Compras de mercadería: ARS 0,00',
      'Total de egresos: ARS 0,00',
    ]);
    assert.doesNotMatch(html, /hidden-service-key|hidden-product-key|Desglose por categoría/);
    assert(dom.window.document.querySelector('[aria-hidden="true"]'));
    dom.window.close();
  }
});
test('BF255 RNWeb partial error retains expense summary and its accessible labels', () => {
  const html = renderToStaticMarkup(
    React.createElement(FinanceProductsExpensesPanel, {
      productsResult: { status: 'error' },
      expensesResult: {
        status: 'success',
        data: {
          manual_total: '1.00',
          purchase_total: '2.00',
          total: '3.00',
          by_category: [{ category_id: null, amount: '3.00' }],
        },
      },
    }),
  );
  const dom = new JSDOM(html);
  assert.match(
    dom.window.document.querySelector('[role="alert"]').getAttribute('aria-label'),
    /No pudimos cargar los productos/,
  );
  assert(dom.window.document.querySelector('[aria-label="Total de egresos: ARS 3,00"]'));
  assert(dom.window.document.querySelector('[aria-label="Sin categoría: ARS 3,00"]'));
  dom.window.close();
});

// Optional private visual fixture: no production routes, auth/session or network data.
if (process.env.BF24_PREVIEW_DIR) {
  const target = path.resolve(process.env.BF24_PREVIEW_DIR);
  const { theme } = load(path.join(__dirname, '../src/theme/index.ts'));
  for (width of [375, 1440]) {
    const app = renderPanels();
    const css = RN.StyleSheet.getSheet().textContent;
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(
      path.join(target, `${width}.html`),
      `<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css} body{margin:0;background:${theme.colors.background};padding:${theme.spacing[16]}px;box-sizing:border-box}</style><body>${app}</body></html>`,
    );
  }
}
