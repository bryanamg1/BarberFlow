/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
for (const name of [
  'HTMLElement',
  'ShadowRoot',
  'Node',
  'Element',
  'SVGElement',
  'MutationObserver',
])
  global[name] = dom.window[name];
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react'),
  { createRoot } = require('react-dom/client'),
  { renderToStaticMarkup } = require('react-dom/server'),
  rn = require('react-native-web');
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
      if (name === 'react-native') return rn;
      if (name === '@/features/business/context/BusinessContext')
        return {
          useBusiness: () => ({
            status: 'success',
            data: { business: { timezone: 'UTC', currency_code: 'ARS' } },
          }),
        };
      if (name === '@/components/ui')
        return Object.assign(
          {},
          ...['Button', 'Card', 'Badge', 'Modal', 'Input', 'ErrorState'].map((part) =>
            load(path.join(__dirname, '../src/components/ui', part + '.tsx')),
          ),
        );
      if (name === 'react-native-safe-area-context')
        return { SafeAreaProvider: ({ children }) => children, SafeAreaView: rn.View };
      if (name.startsWith('.') || name.startsWith('@/')) {
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
const { SaleVoidAction } = load(
  path.join(__dirname, '../src/features/sales/components/SaleVoidAction.tsx'),
);
const { SaleHistoryRow } = load(
  path.join(__dirname, '../src/features/sales/components/SaleHistoryRow.tsx'),
);
const { SaleCorrectionContent } = load(
  path.join(__dirname, '../src/features/sales/components/SaleCorrectionContent.tsx'),
);
const settle = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
test(
  'BF198A actual RN Web Modal traps focus, focuses Motivo, blocks pending Escape, then restores trigger',
  { timeout: 10000 },
  async () => {
    const root = createRoot(document.getElementById('root'));
    let pending = false,
      reset = 0;
    const render = () =>
      root.render(
        React.createElement(SaleVoidAction, {
          available: true,
          pending,
          error: null,
          onConfirm: () => {},
          onReset: () => reset++,
          success: false,
        }),
      );
    await React.act(async () => render());
    const trigger = document.querySelector('[role="button"]');
    await React.act(async () => {
      trigger.focus();
      trigger.click();
    });
    await React.act(settle);
    const field = document.querySelector('textarea');
    assert(field);
    assert.equal(document.activeElement, field);
    assert.equal(field.getAttribute('aria-label'), 'Motivo');
    assert(document.querySelector('[role="dialog"]'));
    await React.act(async () => trigger.focus());
    assert.notEqual(document.activeElement, trigger);
    pending = true;
    await React.act(async () => render());
    assert(field.disabled);
    assert(!document.querySelector('[aria-label="Cerrar"]'));
    await React.act(async () =>
      document.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Escape', bubbles: true })),
    );
    assert.equal(reset, 0);
    assert(document.querySelector('[role="dialog"]'));
    pending = false;
    await React.act(async () => render());
    await React.act(async () =>
      document.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Escape', bubbles: true })),
    );
    await React.act(settle);
    assert.equal(reset, 1);
    assert.equal(document.activeElement, trigger);
    await React.act(async () => root.unmount());
    assert.equal(document.body.style.overflow, '');
  },
);
for (const width of [320, 1280])
  test(`BF198A semantic Web row/audit at viewport ${width}, original snapshots only`, () => {
    window.innerWidth = width;
    const sale = {
      id: 'sale-internal',
      status: 'VOIDED',
      sold_at: null,
      created_at: '2026-10-23T12:00:00Z',
      total: 100,
    };
    const row = renderToStaticMarkup(
      React.createElement(SaleHistoryRow, { sale, onPress: () => {} }),
    );
    assert(row.includes('role="button"'));
    assert(row.includes('Ver venta:'));
    assert(row.includes('Anulada'));
    assert(!row.includes('sale-internal'));
    const items = [
      {
        id: 'line-internal',
        item_type: 'PRODUCT',
        product_id: 'product-internal',
        quantity: 2,
        unit_cost_snapshot: 9,
        item_name_snapshot: 'Nombre histórico extenso '.repeat(8),
      },
    ];
    const data = {
      correction: {
        id: 'audit-internal',
        created_by: 'actor-internal',
        reason: 'Motivo original',
        created_at: '2026-10-23T12:00:00Z',
      },
      stockMovements: [
        {
          id: 'movement-internal',
          product_id: 'product-internal',
          quantity_delta: 2,
          unit_cost: 9,
        },
      ],
    };
    const html = renderToStaticMarkup(
      React.createElement(SaleCorrectionContent, { data, items, userId: 'user', timezone: 'UTC' }),
    );
    assert(html.includes('Stock restituido'));
    assert(html.includes('Cantidad restituida: 2'));
    assert(html.includes('Otro OWNER'));
    assert(html.includes('Nombre histórico extenso'));
    for (const hidden of [
      'audit-internal',
      'movement-internal',
      'actor-internal',
      'product-internal',
      'line-internal',
      'unit_cost',
    ])
      assert(!html.includes(hidden));
  });
