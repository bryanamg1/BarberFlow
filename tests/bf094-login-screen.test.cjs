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

function loadScreen(platform = 'web', integration = false) {
  const cache = new Map();
  const native = integration
    ? require('react-native-web')
    : {
        View: 'View',
        Text: 'Text',
        ScrollView: 'ScrollView',
        KeyboardAvoidingView: 'KeyboardAvoidingView',
        Platform: { OS: platform, select: (options) => options[platform] ?? options.default },
        StyleSheet: { create: (styles) => styles },
      };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    const source = fs.readFileSync(filename, 'utf8');
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = (name) => {
      if (name === 'react-native') return native;
      // Native safe-area measurement is exercised in the actual browser, not this SSR bridge.
      if (name === 'react-native-safe-area-context') {
        return {
          SafeAreaView: integration ? native.View : 'SafeAreaView',
          SafeAreaProvider: 'div',
        };
      }
      if (name === 'expo-router') {
        return {
          Stack: Object.assign('Stack', { Screen: 'StackScreen' }),
          Link: integration
            ? ({ href, children }) => React.createElement('a', { href }, children)
            : 'Link',
        };
      }
      if (name.includes('supabase') || name.includes('authRepository')) {
        assert.fail('Screen must not access Supabase or the repository');
      }
      if (name.endsWith('/authService')) {
        assert(integration, 'Screen delegates all Auth to LoginForm');
        return {
          authService: { signInWithPassword: () => assert.fail('No Auth request on render') },
        };
      }
      if (!integration && name.endsWith('/LoginForm')) return { LoginForm: 'LoginForm' };
      if (!integration && name === '@/components/ui') return { Card: 'Card' };
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/')
          ? path.join(root, 'src', name.slice(2))
          : path.resolve(path.dirname(filename), name);
        const target = ['.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find(fs.existsSync);
        assert(target, `Missing module: ${name}`);
        return load(target);
      }
      return require(name);
    };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
      localRequire,
      module,
      module.exports,
    );
    cache.set(filename, module.exports);
    return module.exports;
  }
  return {
    screen: load(path.join(root, 'src/features/auth/screens/LoginScreen.tsx')).LoginScreen,
    route: () => load(path.join(root, 'src/app/(auth)/login.tsx')).default,
    layout: () => load(path.join(root, 'src/app/(auth)/_layout.tsx')).default(),
    theme: load(path.join(root, 'src/theme/index.ts')).theme,
  };
}

function descendants(element) {
  if (!element || typeof element !== 'object') return [];
  if (Array.isArray(element)) return element.flatMap(descendants);
  return [element, ...descendants(element.props?.children)];
}

test('BF-094: branding, accessible heading and exactly one delegated LoginForm', () => {
  const { screen, theme } = loadScreen();
  const nodes = descendants(screen());
  const texts = nodes.filter((node) => node.type === 'Text');
  assert.deepEqual(
    texts.map((node) => node.props.children),
    ['BarberFlow', 'Inicia sesión para continuar'],
  );
  assert.equal(texts[0].props.role, 'heading');
  assert.equal(texts[0].props.style.fontFamily, theme.typography.display.fontFamily);
  assert.equal(nodes.filter((node) => node.type === 'LoginForm').length, 1);
  assert.equal(nodes.filter((node) => node.type === 'Card').length, 1);
  assert(!nodes.some((node) => ['Input', 'PasswordInput', 'TextInput'].includes(node.type)));
});

test('BF-094: screen uses the approved presentation-only success contract', () => {
  const nodes = descendants(loadScreen().screen());
  const form = nodes.find((node) => node.type === 'LoginForm');
  assert.deepEqual(form.props, {});
  // Omitting the optional callback means no redirect/session operation is introduced by the screen.
  assert.equal(form.props.onSuccess, undefined);
});

for (const platform of ['ios', 'android', 'web']) {
  test(`BF-094: ${platform} safe area and scroll/keyboard composition`, () => {
    const { screen, theme } = loadScreen(platform);
    const tree = screen();
    const nodes = descendants(tree);
    assert.equal(tree.type, 'SafeAreaView');
    assert.deepEqual(tree.props.edges, ['top', 'right', 'bottom', 'left']);
    assert.equal(tree.props.style.flex, 1);
    assert.equal(tree.props.style.backgroundColor, theme.colors.background);
    const keyboard = nodes.find((node) => node.type === 'KeyboardAvoidingView');
    assert.equal(keyboard.props.behavior, platform === 'ios' ? 'padding' : 'height');
    assert.equal(keyboard.props.enabled, platform !== 'web');
    const scrolls = nodes.filter((node) => node.type === 'ScrollView');
    assert.equal(scrolls.length, 1);
    assert.equal(scrolls[0].props.keyboardShouldPersistTaps, 'handled');
    assert.equal(scrolls[0].props.keyboardDismissMode, 'on-drag');
    assert.equal(scrolls[0].props.contentContainerStyle.flexGrow, 1);
    assert.equal(scrolls[0].props.contentContainerStyle.padding, theme.spacing[24]);
  });
}

test('BF-094: mobile fluid width and bounded desktop content, without a new theme contract', () => {
  const nodes = descendants(loadScreen().screen());
  const bounds = nodes.find((node) => node.props?.style?.maxWidth);
  assert.equal(bounds.props.style.width, '100%');
  assert.equal(bounds.props.style.maxWidth, 480);
  assert(!nodes.some((node) => node.props?.style?.height));
});

test('BF-094: existing login route delegates to feature screen and only its Stack header is hidden', () => {
  const loaded = loadScreen();
  assert.equal(loaded.route(), loaded.screen);
  const routes = descendants(loaded.layout());
  assert.equal(
    routes.find((node) => node.props?.name === 'login').props.options.headerShown,
    false,
  );
  assert.deepEqual(routes.find((node) => node.props?.name === 'forgot-password').props.options, {
    title: 'Recuperar contraseña',
  });
});

test('BF-094: real React/Web screen and existing form render empty secure fields without Auth requests', () => {
  const { screen } = loadScreen('web', true);
  const html = renderToStaticMarkup(React.createElement(screen));
  assert.match(html, /role="heading"[^>]*>BarberFlow/);
  assert.match(html, /Inicia sesión para continuar/);
  assert.equal((html.match(/<input /g) ?? []).length, 2);
  assert.match(html, /aria-label="Correo electrónico"/);
  assert.match(html, /aria-label="Contraseña"/);
  assert.match(html, /type="password"/);
  assert.equal((html.match(/value=""/g) ?? []).length, 2);
  assert(!html.includes('owner@barberflow.local'));
  assert(!html.includes('BarberFlow-Local-Only-081!'));
  assert(!html.includes('access_token'));
  assert(!html.includes('refresh_token'));
  assert.match(html, /href="\/forgot-password"/);
});
