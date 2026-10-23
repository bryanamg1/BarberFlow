/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
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
        return Object.assign(
          {},
          ...['Button', 'Card'].map((part) =>
            load(path.join(__dirname, '../src/components/ui', part + '.tsx')),
          ),
        );
      assert(
        !/supabase|repositories|services|hooks|expo-router/.test(name),
        'No card data/navigation dependency: ' + name,
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
const { AppointmentCard } = load(
  path.join(__dirname, '../src/features/appointments/components/AppointmentCard.tsx'),
);
const { row } = require('./helpers/agenda.cjs');
const appointment = Object.freeze(row('a', '2026-10-01T23:30:00Z', '2026-10-02T00:30:00Z'));

test('BF153 real RN Web SSR passive card has a label, no active button and escaped supplied data', () => {
  const html = renderToStaticMarkup(
    React.createElement(AppointmentCard, {
      appointment,
      timezone: 'UTC',
      clientLabel: '<script>not executable</script>',
    }),
  );
  assert.match(html, /aria-label="Turno,/);
  assert.doesNotMatch(html, /role="button"|<button|<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /aria-hidden="true"/);
});
test('BF153 real RN Web SSR compact button keeps original range and accessible continuation/status', () => {
  const html = renderToStaticMarkup(
    React.createElement(AppointmentCard, {
      appointment,
      timezone: 'UTC',
      variant: 'compact',
      segment: { continued: true },
      onPress() {},
    }),
  );
  assert.match(html, /role="button"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-label="Turno, Continúa/);
  assert.match(html, /Pendiente/);
  assert.match(html, /23:30/);
  assert.match(html, /00:30/);
});
test('BF153 real RN Web native button supports focus and browser-default keyboard clicks, then becomes static', async () => {
  const root = createRoot(document.getElementById('root'));
  let pressed = 0;
  try {
    await React.act(async () => {
      root.render(
        React.createElement(AppointmentCard, {
          appointment,
          timezone: 'UTC',
          onPress() {
            pressed++;
          },
        }),
      );
    });
    const button = document.querySelector('[role="button"]');
    assert(button);
    assert.equal(button.tagName, 'BUTTON');
    await React.act(async () => {
      button.focus();
    });
    assert.equal(document.activeElement, button);
    for (const key of ['Enter', ' '])
      await React.act(async () => {
        button.dispatchEvent(
          new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        );
        button.dispatchEvent(
          new window.KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }),
        );
        // JSDOM does not perform the browser's native keyboard-to-click default.
        // RN Web intentionally delegates activation of native BUTTONs to that default.
        button.click();
      });
    assert.equal(pressed, 2);
    await React.act(async () => {
      root.render(React.createElement(AppointmentCard, { appointment, timezone: 'UTC' }));
    });
    assert.equal(document.querySelector('[role="button"]'), null);
    assert.equal(appointment.id, 'a');
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
  }
});
