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
  const componentHooks = new Map();
  const pendingRefs = [];
  let hooks = [];
  let cursor = 0;
  const native = realWeb
    ? require('react-native-web')
    : {
        Platform: { select: (values) => values[platform] ?? values.default },
        StyleSheet: { create: (styles) => styles },
        Pressable: 'Pressable',
        View: 'View',
        Text: 'Text',
        ActivityIndicator: 'ActivityIndicator',
        TextInput: 'TextInput',
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
        return realWeb
          ? React
          : {
              useState: (initial) => {
                const index = cursor++;
                const state = hooks;
                if (!(index in state)) state[index] = initial;
                return [
                  state[index],
                  (value) => {
                    state[index] = typeof value === 'function' ? value(state[index]) : value;
                  },
                ];
              },
              useId: () => ':test-input:',
              useRef: (initial) => {
                const index = cursor++;
                if (!(index in hooks)) hooks[index] = { current: initial };
                return hooks[index];
              },
              useImperativeHandle: (ref, createHandle) => {
                pendingRefs.push(() => {
                  if (typeof ref === 'function') ref(createHandle());
                  else if (ref) ref.current = createHandle();
                });
              },
            };
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

  const components = load('src/components/ui/index.ts');
  function render(component, props) {
    if (!componentHooks.has(component)) componentHooks.set(component, []);
    hooks = componentHooks.get(component);
    cursor = 0;
    return component(props);
  }
  return {
    ...Object.fromEntries(
      Object.entries(components).map(([name, component]) => [
        name,
        realWeb ? component : (props) => render(component, props),
      ]),
    ),
    theme: load('src/theme/index.ts').theme,
    render,
    commitRefs: () => pendingRefs.splice(0).forEach((commit) => commit()),
  };
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

function nodes(element) {
  if (!element || typeof element !== 'object' || !element.props) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(nodes)];
}

for (const platform of ['ios', 'android', 'web']) {
  test(`${platform}: Input names, focus/error precedence, changes, disabled and read-only`, () => {
    const ui = loadUI(platform);
    let changes = [];
    let focused = 0;
    let blurred = 0;
    const ref = { current: null };
    const props = {
      label: 'Nombre',
      value: '',
      onChangeText: (value) => changes.push(value),
      onFocus: () => focused++,
      onBlur: () => blurred++,
      helperText: 'Ayuda',
      ref,
      keyboardType: 'email-address',
      containerStyle: { margin: ui.theme.spacing[8] },
      style: { minHeight: ui.theme.spacing[4] },
    };
    let output = ui.Input(props);
    const getInput = (tree) => nodes(tree).find((node) => node.type === 'TextInput');
    const getBorder = (tree) =>
      nodes(tree)
        .map((node) => flatten(node.props.style))
        .find((style) => style.borderWidth === ui.theme.borderWidths.thin);
    let input = getInput(output);
    assert.equal(input.props.ref, ref);
    assert.equal(input.props['aria-label'], 'Nombre');
    assert.equal(input.props.keyboardType, 'email-address');
    assert.equal(flatten(input.props.style).fontFamily, ui.theme.fontFamilies.regular);
    assert.equal(flatten(input.props.style).minHeight, ui.theme.sizing.touchTarget);
    assert.equal(flatten(output.props.style).margin, ui.theme.spacing[8]);
    input.props.onChangeText('Ana');
    assert.deepEqual(changes, ['Ana']);
    input.props.onFocus({});
    output = ui.Input(props);
    assert.equal(focused, 1);
    assert.equal(getBorder(output).borderColor, ui.theme.semanticColors.input.focusedBorder);
    output = ui.Input({ ...props, error: 'Requerido' });
    input = getInput(output);
    assert.equal(getBorder(output).borderColor, ui.theme.semanticColors.input.errorBorder);
    assert.equal(input.props.accessibilityHint, 'Error: Requerido');
    assert(nodes(output).some((node) => node.props.children === 'Error: Requerido'));
    assert(!nodes(output).some((node) => node.props.children === 'Ayuda'));
    if (platform === 'web') {
      assert.equal(input.props['aria-invalid'], true);
      assert(input.props['aria-describedby'].endsWith('-message'));
    }
    input.props.onBlur({});
    assert.equal(blurred, 1);
    for (const state of [{ disabled: true }, { readOnly: true }, { editable: false }]) {
      input = getInput(ui.Input({ ...props, ...state }));
      input.props.onChangeText('Blocked');
      assert.equal(input.props.editable, false);
      assert.equal(input.props.readOnly, true);
    }
    assert.deepEqual(changes, ['Ana']);
    const uncontrolled = loadUI(platform);
    output = uncontrolled.Input({ accessibilityLabel: 'Notas', defaultValue: '' });
    getInput(output).props.onChangeText('Texto');
    output = uncontrolled.Input({ accessibilityLabel: 'Notas', defaultValue: '' });
    assert.equal(getInput(output).props.value, undefined);
    assert.equal(getBorder(output).borderColor, ui.theme.colors.borderStrong);
  });

  test(`${platform}: PasswordInput masks, toggles without altering value and forwards focus ref`, () => {
    const ui = loadUI(platform);
    const ref = { current: null };
    let focusCount = 0;
    const props = { value: 'example-password', ref };
    let output = ui.PasswordInput(props);
    assert.equal(output.props.label, 'Contraseña');
    assert.equal(
      ui.PasswordInput({ ...props, accessibilityLabel: 'Clave' }).props.label,
      undefined,
    );
    assert.equal(output.props.secureTextEntry, true);
    assert.equal(output.props.autoCapitalize, 'none');
    assert.equal(output.props.autoCorrect, false);
    assert.equal(output.props.multiline, false);
    output.props.ref.current = { focus: () => focusCount++ };
    ui.commitRefs();
    assert.equal(ref.current, output.props.ref.current);
    output.props.trailingAccessory.props.onPress();
    output = ui.PasswordInput(props);
    assert.equal(output.props.secureTextEntry, false);
    assert.equal(output.props.value, 'example-password');
    assert.equal(output.props.trailingAccessory.props.accessibilityLabel, 'Ocultar contraseña');
    assert.equal(focusCount, 1);
    output.props.trailingAccessory.props.onPress();
    assert.equal(ui.PasswordInput(props).props.secureTextEntry, true);
    for (const state of [{ disabled: true }, { readOnly: true }, { editable: false }]) {
      output = ui.PasswordInput({ ...props, ...state });
      assert.equal(output.props.trailingAccessory.props.disabled, true);
      output.props.trailingAccessory.props.onPress();
      assert.equal(ui.PasswordInput(props).props.secureTextEntry, true);
    }
  });

  test(`${platform}: SearchInput clear emits once, restores focus and respects non-editable states`, () => {
    const ui = loadUI(platform);
    const changes = [];
    const ref = { current: null };
    let focusCount = 0;
    const props = { value: 'texto', onChangeText: (value) => changes.push(value), ref };
    let output = ui.SearchInput(props);
    assert.equal(output.props.label, 'Buscar');
    assert.equal(
      ui.SearchInput({ ...props, accessibilityLabel: 'Búsqueda' }).props.label,
      undefined,
    );
    assert.equal(output.props.inputMode, 'search');
    assert.equal(output.props.enterKeyHint, 'search');
    assert.equal(output.props.autoCorrect, false);
    assert.equal(output.props.multiline, false);
    output.props.ref.current = { focus: () => focusCount++ };
    ui.commitRefs();
    assert.equal(ref.current, output.props.ref.current);
    output.props.trailingAccessory.props.onPress();
    assert.deepEqual(changes, ['']);
    assert.equal(focusCount, 1);
    assert.equal(ui.SearchInput({ ...props, value: '' }).props.trailingAccessory, false);
    for (const state of [{ disabled: true }, { readOnly: true }, { editable: false }]) {
      output = ui.SearchInput({ ...props, ...state });
      assert.equal(output.props.trailingAccessory.props.disabled, true);
      output.props.trailingAccessory.props.onPress();
    }
    assert.deepEqual(changes, ['']);
  });
}

test('Web: actual TextInput renders unique labels/messages, error description, password and search types', () => {
  const { Input, PasswordInput, SearchInput } = loadUI('web', true);
  const markup = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(Input, { label: 'Nombre', error: 'Requerido', helperText: 'Oculto' }),
      React.createElement(Input, {
        accessibilityLabel: 'Notas',
        helperText: 'Ayuda',
        disabled: true,
      }),
      React.createElement(PasswordInput, { value: 'test' }),
      React.createElement(SearchInput, { value: 'texto', onChangeText: () => {} }),
    ),
  );
  assert.match(markup, /aria-invalid="true"/);
  assert.match(markup, /aria-describedby="[^"]+-message"/);
  assert.match(markup, /Error: Requerido/);
  assert(!markup.includes('Oculto'));
  assert.match(markup, /type="password"/);
  assert.match(markup, /type="search"/);
  assert.match(markup, /disabled=""/);
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of markup.matchAll(/aria-describedby="([^"]+)"/g)) {
    assert(ids.includes(match[1]));
  }
});

for (const platform of ['ios', 'android', 'web']) {
  test(`${platform}: LoadingState has a named indeterminate busy state and a decorative spinner`, () => {
    const ui = loadUI(platform);
    const output = ui.LoadingState({
      message: 'Cargando información',
      style: { flex: 1 },
      testID: 'loading-section',
    });
    assert.equal(output.props.role, 'progressbar');
    assert.equal(output.props['aria-label'], 'Cargando información');
    assert.equal(output.props['aria-busy'], true);
    assert.equal(output.props.accessibilityState.busy, true);
    assert.equal(output.props.accessible, true);
    assert.equal(output.props['aria-valuenow'], undefined);
    assert.equal(output.props.testID, 'loading-section');
    const style = flatten(output.props.style);
    assert.equal(style.flex, 1);
    assert.equal(style.alignItems, 'center');
    assert.equal(style.justifyContent, 'center');
    const spinner = nodes(output).find((node) => node.type === 'ActivityIndicator');
    assert.equal(spinner.props.color, ui.theme.colors.primary);
    assert.equal(spinner.props['aria-hidden'], true);
    assert.equal(spinner.props.accessible, false);
    const text = nodes(output).find((node) => node.type === 'Text');
    assert.equal(flatten(text.props.style).fontFamily, ui.theme.fontFamilies.regular);
    assert.equal(text.props.allowFontScaling, undefined);
    assert.equal(text.props.numberOfLines, undefined);
    assert.equal(ui.LoadingState({}).props['aria-label'], 'Cargando…');
    const silent = ui.LoadingState({ message: '' });
    assert.equal(silent.props['aria-label'], 'Cargando…');
    assert(!nodes(silent).some((node) => node.type === 'Text'));
  });

  test(`${platform}: EmptyState keeps actions outside its status group and delegates blocked states`, () => {
    const ui = loadUI(platform);
    assert(!nodes(ui.EmptyState({})).some((node) => typeof node.type === 'function'));
    let presses = 0;
    for (const state of [{}, { loading: true }, { disabled: true }]) {
      const output = ui.EmptyState({
        title: 'Sin resultados',
        message: 'Cambia tu búsqueda.',
        action: { label: 'Continuar', onPress: () => presses++, ...state },
        style: { margin: ui.theme.spacing[8] },
      });
      assert.equal(output.props.accessible, undefined);
      assert.equal(flatten(output.props.style).margin, ui.theme.spacing[8]);
      const status = nodes(output).find((node) => node.props.role === 'status');
      assert.equal(status.props['aria-live'], 'polite');
      assert.equal(status.props['aria-label'], 'Sin resultados. Cambia tu búsqueda.');
      assert(!nodes(status).some((node) => typeof node.type === 'function'));
      const action = nodes(output).find((node) => typeof node.type === 'function');
      const button = ui.render(action.type, action.props);
      if (state.disabled || state.loading) {
        assert.equal(button.props.onPress, undefined);
        assert.equal(button.props.disabled, true);
      } else {
        button.props.onPress();
      }
    }
    assert.equal(presses, 1);
  });

  test(`${platform}: ErrorState exposes an alert, optional retry and caller-owned retry status`, () => {
    const ui = loadUI(platform);
    let retries = 0;
    const props = {
      message: 'Inténtalo nuevamente.',
      onRetry: () => retries++,
      retryLabel: 'Volver a intentar',
    };
    for (const state of [{}, { retrying: true }, { retryDisabled: true }]) {
      const output = ui.ErrorState({ ...props, ...state });
      assert.equal(output.props.accessible, undefined);
      const alert = nodes(output).find((node) => node.props.role === 'alert');
      assert.equal(alert.props['aria-live'], 'assertive');
      assert.equal(alert.props['aria-label'], 'Ocurrió un error. Inténtalo nuevamente.');
      assert(!nodes(alert).some((node) => typeof node.type === 'function'));
      const title = nodes(alert).find((node) => node.props.children === 'Ocurrió un error');
      assert.equal(flatten(title.props.style).color, ui.theme.colors.danger);
      assert.equal(flatten(title.props.style).fontFamily, ui.theme.fontFamilies.bold);
      assert.equal(flatten(title.props.style).fontSize, ui.theme.typography.headingLg.fontSize);
      assert(contrast(ui.theme.colors.danger, ui.theme.colors.surfaceStrong) >= 3);
      const action = nodes(output).find((node) => typeof node.type === 'function');
      const button = ui.render(action.type, action.props);
      assert.equal(button.props['aria-label'], 'Volver a intentar');
      if (state.retrying || state.retryDisabled) {
        assert.equal(button.props.onPress, undefined);
        assert.equal(button.props.disabled, true);
      } else {
        button.props.onPress();
      }
    }
    assert.equal(retries, 1);
    assert(!nodes(ui.ErrorState({})).some((node) => typeof node.type === 'function'));
  });

  test(`${platform}: Skeleton is static, hidden from accessibility, ignores touches and composes token dimensions`, () => {
    const ui = loadUI(platform);
    const output = ui.Skeleton({});
    assert.equal(output.props.role, 'presentation');
    assert.equal(output.props.accessible, false);
    assert.equal(output.props['aria-hidden'], true);
    assert.equal(output.props.importantForAccessibility, 'no-hide-descendants');
    assert.equal(flatten(output.props.style).pointerEvents, 'none');
    assert.equal(output.props.children, undefined);
    const style = flatten(output.props.style);
    assert.equal(style.width, '100%');
    assert.equal(style.height, ui.theme.spacing[24]);
    assert.equal(style.backgroundColor, ui.theme.colors.surfaceStrong);
    assert.equal(style.borderRadius, ui.theme.radius[8]);
    const custom = ui.Skeleton({
      width: ui.theme.sizing.touchTarget,
      height: ui.theme.spacing[40],
      radius: 'pill',
      style: { margin: ui.theme.spacing[8] },
      testID: 'placeholder-block',
    });
    assert.equal(custom.props.testID, 'placeholder-block');
    assert.equal(flatten(custom.props.style).width, ui.theme.sizing.touchTarget);
    assert.equal(flatten(custom.props.style).height, ui.theme.spacing[40]);
    assert.equal(flatten(custom.props.style).borderRadius, ui.theme.radius.pill);
    assert.equal(flatten(custom.props.style).margin, ui.theme.spacing[8]);
  });
}

test('Web: real feedback markup names busy progress, separates status/alert actions and hides skeletons', () => {
  const { LoadingState, EmptyState, ErrorState, Skeleton } = loadUI('web', true);
  const markup = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(LoadingState, { message: 'Cargando información' }),
      React.createElement(EmptyState, {
        title: 'Sin resultados',
        message: 'Prueba otra búsqueda.',
        action: { label: 'Continuar', onPress: () => {} },
      }),
      React.createElement(ErrorState, { message: 'Inténtalo nuevamente.', onRetry: () => {} }),
      React.createElement(Skeleton, { testID: 'skeleton-block' }),
    ),
  );
  assert.match(markup, /role="progressbar"/);
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /aria-label="Cargando información"/);
  assert(!markup.includes('aria-valuenow'));
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /role="alert"/);
  assert.match(markup, /aria-live="assertive"/);
  const buttons = [...markup.matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag);
  for (const label of ['Continuar', 'Reintentar']) {
    assert(
      buttons.some((tag) => tag.includes('role="button"') && tag.includes(`aria-label="${label}"`)),
    );
  }
  assert.match(
    markup,
    /aria-hidden="true"[^>]*role="presentation"[^>]*data-testid="skeleton-block"/,
  );
});
