/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { test } = require('node:test');
const { JSDOM } = require('jsdom'),
  ts = require('typescript');
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
  { createRoot } = require('react-dom/client'),
  { renderToStaticMarkup } = require('react-dom/server');
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
      if (name === 'react-native') return require('react-native-web');
      if (name === '@/components/ui')
        return load(path.join(__dirname, '../src/components/ui/Button.tsx'));
      assert(
        !/supabase|repositories|services|hooks|agendaCalendar|expo-router/.test(name),
        'No selector data/time/navigation dependency: ' + name,
      );
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
const { FinanceTabs } = load(
  path.join(__dirname, '../src/features/analytics/components/FinanceTabs.tsx'),
);

test('BF253 Web SSR has four named native Finance controls, one pressed state and no partial tablist', () => {
  const html = renderToStaticMarkup(
    React.createElement(FinanceTabs, { value: 'overview', onChange() {} }),
  );
  assert.equal((html.match(/role="button"/g) || []).length, 4);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  for (const label of ['Resumen', 'Servicios', 'Productos', 'Gastos']) assert(html.includes(label));
  assert.doesNotMatch(html, /role="tablist"|aria-selected/);
});
test('BF253 Web focus and native click emit controlled selection, external value controls pressed option', async () => {
  const root = createRoot(document.getElementById('root')),
    changes = [];
  try {
    await React.act(async () =>
      root.render(
        React.createElement(FinanceTabs, { value: 'overview', onChange: (v) => changes.push(v) }),
      ),
    );
    const buttons = [...document.querySelectorAll('[role=button]')];
    assert.equal(buttons.length, 4);
    for (const button of buttons) {
      assert.equal(button.tagName, 'BUTTON');
      await React.act(async () => {
        button.focus();
        button.click();
      });
      assert.equal(document.activeElement, button);
    }
    assert.deepEqual(changes, ['overview', 'services', 'products', 'expenses']);
    assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
    await React.act(async () =>
      root.render(
        React.createElement(FinanceTabs, { value: 'products', onChange: (v) => changes.push(v) }),
      ),
    );
    assert.equal(document.querySelectorAll('[aria-pressed=true]').length, 1);
    assert.equal(
      document.querySelector('[aria-pressed=true]').getAttribute('aria-label'),
      'Productos',
    );
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
  }
});
