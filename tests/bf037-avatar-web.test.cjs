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
const cache = new Map();
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(
    (name) => {
      if (name === 'react-native') return require('react-native-web');
      if (name.startsWith('.') || name.startsWith('@/')) {
        const base = name.startsWith('@/')
          ? path.join(root, 'src', name.slice(2))
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
const { Avatar } = load(path.join(root, 'src/components/ui/Avatar.tsx'));

test('BF037 real React Native Web SSR renders one named avatar with hidden Unicode fallback', () => {
  const html = renderToStaticMarkup(React.createElement(Avatar, { label: 'Élodie Durand' }));
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="Élodie Durand"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, />ÉD</);
  assert.doesNotMatch(html, /<button|<a\s|<img/);
});

test('BF037 real Web SSR renders a supplied image without provisioning or native-only APIs', () => {
  const html = renderToStaticMarkup(
    React.createElement(Avatar, {
      label: 'Ana',
      imageUri: 'https://images.example.test/avatar.png',
      accessibilityLabel: 'Foto de Ana',
    }),
  );
  assert.match(html, /aria-label="Foto de Ana"/);
  assert.match(html, /aria-hidden="true"/);
  // RN Web resolves remote images on the client; SSR verifies the safe image branch only.
  assert.doesNotMatch(html, />A</);
});

test('BF037 real Web SSR preserves empty-label accessible and visible fallback', () => {
  const html = renderToStaticMarkup(React.createElement(Avatar, { label: ' \t ' }));
  assert.match(html, /aria-label="Avatar"/);
  assert.match(html, />\?</);
});
