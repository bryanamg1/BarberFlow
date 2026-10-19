/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');
const ts = require('typescript');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost',
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
for (const name of ['ShadowRoot', 'Node', 'Element', 'SVGElement', 'MutationObserver'])
  global[name] = dom.window[name];
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { renderToStaticMarkup } = require('react-dom/server');
const rn = require('react-native-web');
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
      if (name === '@/components/ui')
        return Object.assign(
          {},
          ...['Button', 'Card', 'Badge'].map((part) =>
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
const { usePurchaseDialogFocus } = load(
  path.join(__dirname, '../src/features/purchases/hooks/usePurchaseDialogFocus.ts'),
);
const { Modal } = load(path.join(__dirname, '../src/components/ui/Modal.tsx'));
const { Input } = load(path.join(__dirname, '../src/components/ui/Input.tsx'));
const { Button } = load(path.join(__dirname, '../src/components/ui/Button.tsx'));
const { PurchaseDetailContent } = load(
  path.join(__dirname, '../src/features/purchases/components/PurchaseDetailContent.tsx'),
);
test(
  'BF216B real RN Web purchase focus hook and shared overlay focuses reason, traps focus, Escape cancels and restores initiating control; pending cannot dismiss',
  { timeout: 10000 },
  async () => {
    let setOpen, setPending;
    let closed = 0;
    function App() {
      const [open, updateOpen] = React.useState(false);
      setOpen = updateOpen;
      const [pending, updatePending] = React.useState(false);
      setPending = updatePending;
      const { inputRef, triggerRef } = usePurchaseDialogFocus(open);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(Button, {
          ref: triggerRef,
          label: 'Anular compra',
          onPress: () => updateOpen(true),
        }),
        React.createElement(
          Modal,
          {
            visible: open,
            onClose: () => {
              closed++;
              updateOpen(false);
            },
            dismissible: !pending,
            title: 'Anular compra',
          },
          React.createElement(Input, {
            ref: inputRef,
            label: 'Motivo',
            autoFocus: true,
            disabled: pending,
          }),
        ),
      );
    }
    const root = createRoot(document.getElementById('root'));
    await React.act(async () => {
      root.render(React.createElement(App));
    });
    const trigger = document.querySelector('[role="button"]');
    await React.act(async () => {
      trigger.focus();
    });
    await React.act(async () => {
      setOpen(true);
    });

    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const field = document.querySelector('input');
    assert(field);
    await React.act(async () => {
      field.focus();
    });
    assert.ok(document.activeElement === field, 'reason receives focus');
    await React.act(async () => {
      trigger.focus();
    });
    assert.ok(document.activeElement !== trigger, 'focus stays in modal');
    await React.act(async () => {
      setPending(true);
    });

    await React.act(async () => {
      document.dispatchEvent(
        new window.KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, bubbles: true }),
      );
    });
    assert.equal(closed, 0);
    await React.act(async () => {
      setPending(false);
    });
    await React.act(async () => {
      document.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
    });

    assert.equal(closed, 1);
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    assert.ok(document.activeElement === trigger, 'focus returns to trigger');
    await React.act(async () => {
      root.unmount();
    });
    assert.equal(document.body.style.overflow, '');
  },
);
test('BF216B real RN Web renders semantic compact historical audit at narrow and wide layout without internal IDs', () => {
  const item = {
    id: 'internal-line',
    product_name_snapshot: 'Producto archivado',
    quantity: 2,
    unit_cost_snapshot: 1,
    line_total: 2,
  };
  const data = {
    purchase: {
      id: 'internal-purchase',
      supplier: 'Proveedor',
      total: 2,
      purchased_at: null,
      status: 'VOIDED',
      notes: null,
    },
    items: [item, { ...item, id: 'second-line', quantity: 3 }],
    expense: {
      amount: 2,
      expense_date: '2026-01-01',
      payment_method: 'CASH',
      category_name: 'Archivada',
    },
    voidInfo: {
      status: 'available',
      reason: '  Original  ',
      created_at: '2026-01-01T00:00:00Z',
      stockCompensation: [
        { purchase_item_id: 'internal-line', quantity_delta: -2 },
        { purchase_item_id: 'second-line', quantity_delta: -3 },
      ],
    },
  };
  for (const wide of [false, true]) {
    const html = renderToStaticMarkup(
      React.createElement(PurchaseDetailContent, { data, currency: 'ARS', timezone: 'UTC', wide }),
    );
    assert.match(html, /Anulada por un propietario/);
    assert.match(html, /Cantidad descontada del stock: 2/);
    assert.match(html, /Cantidad descontada del stock: 3/);
    assert.match(html, /role="heading"/);
    assert.match(html, /Gasto original/);
    assert.match(html, /no devuelve dinero/);
    assert.doesNotMatch(
      html,
      /internal-line|internal-purchase|second-line|operation_id|reference_id/,
    );
  }
});
