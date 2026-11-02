/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript'),
  React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../src');
function load(file, cache = new Map()) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const local = (name) => {
    if (name === 'react-native') return require('react-native-web');
    if (name.startsWith('.') || name.startsWith('@/')) {
      const base = name.startsWith('@/')
        ? path.join(root, name.slice(2))
        : path.resolve(path.dirname(file), name);
      const resolved = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(
        fs.existsSync,
      );
      return load(resolved, cache);
    }
    return require(name);
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
    local,
    module,
    module.exports,
  );
  return module.exports;
}
test('real RN Web primitives render without window/document on server', () => {
  assert.equal(typeof window, 'undefined');
  assert.equal(typeof document, 'undefined');
  const { ResponsiveContainer } = load(
    path.join(root, 'components/layout/ResponsiveContainer.tsx'),
  );
  const { ResponsiveColumns } = load(path.join(root, 'components/layout/ResponsiveColumns.tsx'));
  const html = renderToStaticMarkup(
    React.createElement(
      ResponsiveContainer,
      { accessibilityLabel: 'Contenido' },
      React.createElement(
        ResponsiveColumns,
        null,
        React.createElement('span', null, 'Primero'),
        React.createElement('span', null, 'Segundo'),
      ),
    ),
  );
  assert(html.includes('Primero'));
  assert(html.includes('Segundo'));
  assert(html.indexOf('Primero') < html.indexOf('Segundo'));
  assert(html.includes('aria-label="Contenido"'));
  assert(!html.includes('role="dialog"'));
});
test('shared layout has no domain, direct DOM, manual listener or platform-only dependency', () => {
  for (const name of ['ResponsiveContainer.tsx', 'ResponsiveColumns.tsx', 'useWideLayout.ts']) {
    const s = fs.readFileSync(path.join(root, 'components/layout', name), 'utf8');
    assert(
      !/window\.|document\.|addEventListener|supabase|features\/|expo-router|useQuery|process\.env/.test(
        s,
      ),
    );
  }
  const names = fs.readdirSync(path.join(root, 'components/layout'));
  assert(!names.some((n) => n.includes('.web.')));
});
