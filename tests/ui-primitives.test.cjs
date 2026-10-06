/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');

// Compile the actual modules; keep native host components and focus state controllable.
// The Web rendering test below uses real React and React Native Web instead.
function loadUI(platform, realWeb = false) {
  const cache = new Map();
  let focused = false;
  const native = realWeb
    ? require('react-native-web')
    : {
        Platform: { select: (values) => values[platform] ?? values.default },
        StyleSheet: { create: (styles) => styles },
        Pressable: 'Pressable',
        View: 'View',
        Text: 'Text',
        ActivityIndicator: 'ActivityIndicator',
      };

  function load(filename) {
    const absolute = path.resolve(root, filename);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const module = { exports: {} };
    cache.set(absolute, module);
    const compiled = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = (name) => {
      if (name === 'react-native') return native;
      if (name === 'react') {
        return realWeb ? React : { useState: () => [focused, (value) => (focused = value)] };
      }
      if (name.startsWith('.') || name.startsWith('@/')) {
        const base = name.startsWith('@/')
          ? path.join(root, 'src', name.slice(2))
          : path.resolve(path.dirname(absolute), name);
        const target = ['.ts', '.tsx', '/index.ts']
          .map((extension) => base + extension)
          .find((candidate) => fs.existsSync(candidate));
        assert(target, `Module not found: ${name}`);
        return load(target);
      }
      return require(name);
    };
    vm.runInThisContext(`(function(require, module, exports) {${compiled}\n})`, {
      filename: absolute,
    })(localRequire, module, module.exports);
    return module.exports;
  }

  return { ...load('src/components/ui/index.ts'), theme: load('src/theme/index.ts').theme };
}

function flatten(style) {
  return Object.assign(
    {},
    ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean),
  );
}

function contrast(foreground, background) {
  const luminance = (hex) => {
    const linear = hex.match(/[\da-f]{2}/gi).map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const platform of ['ios', 'android', 'web']) {
  test(`${platform}: Button labels, contrast, pressed styles and touch targets for all variants`, () => {
    const { Button, theme } = loadUI(platform);
    for (const variant of ['primary', 'secondary', 'outline', 'danger', 'ghost']) {
      let presses = 0;
      const button = Button({ label: 'Continuar', variant, onPress: () => presses++ });
      assert.equal(button.props.role, 'button');
      assert.equal(button.props['aria-label'], 'Continuar');
      button.props.onPress();
      assert.equal(presses, 1);
      for (const pressed of [false, true]) {
        const container = flatten(button.props.style({ pressed }));
        const content = button.props.children({ pressed }).props.children;
        const label = content.find((node) => node && node.type === 'Text');
        const text = flatten(label.props.style);
        assert.equal(label.props.children, 'Continuar');
        assert.equal(text.fontFamily, theme.fontFamilies.medium);
        assert(container.minHeight >= theme.sizing.touchTarget);
        assert(container.minWidth >= theme.sizing.touchTarget);
        assert(contrast(text.color, container.backgroundColor ?? theme.colors.background) >= 4.5);
      }
      assert.notDeepEqual(
        button.props.style({ pressed: false }),
        button.props.style({ pressed: true }),
      );
    }
  });

  test(`${platform}: loading/disabled block handlers while keeping the accessible name and label`, () => {
    const { Button, IconButton, theme } = loadUI(platform);
    for (const state of [
      { loading: true },
      { disabled: true },
      { loading: true, disabled: true },
    ]) {
      const button = Button({
        label: 'Guardar',
        onPress: () => assert.fail('Blocked press'),
        ...state,
      });
      assert.equal(button.props.disabled, true);
      assert.equal(button.props.onPress, undefined);
      assert.equal(button.props.accessibilityState.disabled, true);
      assert.equal(button.props['aria-disabled'], true);
      assert.equal(button.props['aria-busy'], state.loading === true);
      const content = button.props.children({ pressed: false }).props.children;
      assert(content.some((node) => node && node.props.children === 'Guardar'));
      const spinner = content.find((node) => node && node.type === 'ActivityIndicator');
      assert.equal(Boolean(spinner), state.loading === true);
      if (spinner) assert.equal(spinner.props['aria-hidden'], true);
      assert.deepEqual(
        button.props.style({ pressed: false }),
        button.props.style({ pressed: true }),
      );
    }
    const icon = IconButton({
      accessibilityLabel: 'Agregar',
      disabled: true,
      icon: (props) => props,
      onPress: () => assert.fail('Disabled icon press'),
    });
    assert.equal(icon.props.onPress, undefined);
    const content = icon.props.children({ pressed: true });
    assert.equal(content.props['aria-hidden'], true);
    assert.equal(content.props.children.color, theme.colors.textMuted);
  });

  test(`${platform}: focus is visible and caller callbacks/styles compose with touch minimums`, () => {
    const ui = loadUI(platform);
    for (const component of [ui.Button, ui.IconButton]) {
      let focusCalls = 0;
      let blurCalls = 0;
      const props = {
        label: 'Continuar',
        accessibilityLabel: 'Acción',
        icon: (iconProps) => iconProps,
        onFocus: () => focusCalls++,
        onBlur: () => blurCalls++,
        style: () => ({ minHeight: ui.theme.spacing[4], margin: ui.theme.spacing[8] }),
      };
      let control = component(props);
      control.props.onFocus({});
      control = component(props);
      const focusedStyle = flatten(control.props.style({ pressed: false }));
      assert.equal(focusCalls, 1);
      assert.equal(focusedStyle.borderWidth, ui.theme.borderWidths.thin);
      if (platform === 'web') assert.equal(focusedStyle.outlineWidth, ui.theme.borderWidths.thin);
      assert.equal(focusedStyle.margin, ui.theme.spacing[8]);
      assert.equal(focusedStyle.minHeight, ui.theme.sizing.touchTarget);
      control.props.onBlur({});
      assert.equal(blurCalls, 1);
      control = component(props);
      assert.equal(flatten(control.props.style({ pressed: false })).outlineWidth, undefined);
    }
  });

  test(`${platform}: Card preserves children; Badge labels have contrast; Divider is decorative`, () => {
    const { Card, Badge, Divider, theme } = loadUI(platform);
    const card = Card({ children: 'Contenido', style: { gap: theme.spacing[8] } });
    assert.equal(card.props.children, 'Contenido');
    assert.equal(card.props.accessible, undefined);
    assert.equal(flatten(card.props.style).gap, theme.spacing[8]);
    assert.equal(flatten(card.props.style).borderWidth, theme.borderWidths.thin);
    for (const tone of ['neutral', 'primary', 'accent', 'success', 'warning', 'danger']) {
      const badge = Badge({ label: 'Estado visible', tone });
      const container = flatten(badge.props.style);
      const text = flatten(badge.props.children.props.style);
      assert.equal(badge.props.children.props.children, 'Estado visible');
      assert.equal(text.fontFamily, theme.fontFamilies.regular);
      assert(
        contrast(text.color, container.backgroundColor) >= 4.5,
        `${tone}: insufficient contrast`,
      );
    }
    const divider = Divider({});
    assert.equal(divider.props['aria-hidden'], true);
    assert.equal(divider.props.accessible, false);
    assert.equal(flatten(divider.props.style).borderBottomWidth, theme.borderWidths.thin);
  });
}

test('Web: real React Native Web renders labels, ARIA busy/disabled and icon names', () => {
  const { Button, IconButton, Card, Badge, Divider } = loadUI('web', true);
  const markup = renderToStaticMarkup(
    React.createElement(
      Card,
      null,
      React.createElement(Button, { label: 'Guardar', loading: true }),
      React.createElement(IconButton, {
        accessibilityLabel: 'Agregar',
        icon: () => React.createElement('span', null, '+'),
      }),
      React.createElement(Badge, { label: 'Disponible', tone: 'success' }),
      React.createElement(Divider),
    ),
  );
  assert.match(markup, /role="button"/);
  assert.match(markup, /aria-label="Guardar"/);
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /aria-disabled="true"/);
  assert.match(markup, /aria-label="Agregar"/);
  assert.match(markup, /Disponible/);
  assert.match(markup, /aria-hidden="true"/);
});
