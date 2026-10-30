/* global __dirname */
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const assert = require('node:assert/strict'),
  ts = require('typescript');
const { JSDOM } = require('jsdom');

module.exports = function navigationWeb() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/agenda',
    pretendToBeVisual: true,
  });
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  for (const k of [
    'HTMLElement',
    'Node',
    'Element',
    'SVGElement',
    'ShadowRoot',
    'MutationObserver',
  ])
    global[k] = dom.window[k];
  global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require('react'),
    RN = require('react-native-web'),
    { createRoot } = require('react-dom/client');
  const rootDir = path.resolve(__dirname, '../../src'),
    cache = new Map();
  const state = {
    role: 'OWNER',
    userId: 'u',
    businessId: 'b',
    membershipId: 'm',
    status: 'authenticated',
    pathname: '/agenda',
    focused: true,
    isFetching: false,
    bottom: 0,
  };
  const navigation = [];
  const navigationTasks = [];
  let root, lastTabsProps;
  function Tabs({ children, ...props }) {
    lastTabsProps = { children, ...props };
    const [selected, setSelected] = React.useState('agenda');
    return React.createElement(
      RN.View,
      { style: props.screenOptions.tabBarStyle, 'data-testid': 'bar' },
      React.Children.toArray(children).map((child) => {
        const { name, options } = child.props;
        if (options.tabBarButton)
          return React.createElement(RN.View, { key: name }, options.tabBarButton());
        return React.createElement(
          RN.Pressable,
          {
            key: name,
            role: 'tab',
            'aria-label': options.title,
            'aria-selected': selected === name,
            onPress: () => setSelected(name),
          },
          React.createElement(RN.Text, null, options.title),
        );
      }),
    );
  }
  Tabs.Screen = function Screen() {
    return null;
  };
  const router = {
    push: (target) => {
      navigation.push({
        target,
        dialogPresent: !!document.querySelector('[role="dialog"]'),
        focusedLabel: document.activeElement?.getAttribute('aria-label'),
      });
      if (state.destinationFocus) {
        const destination = document.createElement('button');
        destination.setAttribute('data-destination', 'true');
        destination.textContent = 'Destination focus';
        document.body.appendChild(destination);
        destination.focus();
      }
    },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports,queueMicrotask){${code}\n})`, {
      filename: file,
    })(
      (name) => {
        if (name === 'react-native') return RN;
        if (name === 'expo-symbols')
          return { SymbolView: () => React.createElement(RN.Text, { 'aria-hidden': true }, '+') };
        if (name === 'react-native-safe-area-context')
          return {
            useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: state.bottom }),
            SafeAreaProvider: ({ children }) => children,
            SafeAreaView: ({ edges, ...p }) => React.createElement(RN.View, p),
          };
        if (name === 'expo-router')
          return {
            Tabs,
            router,
            usePathname: () => state.pathname,
            useIsFocused: () => state.focused,
          };
        if (name === '@/features/auth/context/AuthContext')
          return {
            useAuth: () => ({
              status: state.status,
              user: state.status === 'authenticated' ? { id: state.userId } : null,
            }),
          };
        if (name === '@/features/business/context/BusinessContext')
          return {
            useBusiness: () => ({
              status: 'success',
              isFetching: state.isFetching,
              data: {
                role: state.role,
                membershipId: state.membershipId,
                business: { id: state.businessId },
              },
            }),
          };
        if (name === '@/components/ui')
          return {
            IconButton: load(path.join(rootDir, 'components/ui/IconButton.tsx')).IconButton,
            Button: load(path.join(rootDir, 'components/ui/Button.tsx')).Button,
            BottomSheet: load(path.join(rootDir, 'components/ui/BottomSheet.tsx')).BottomSheet,
          };
        assert(
          !/supabase|repositories|services/.test(name),
          'navigation must not own transport: ' + name,
        );
        if (name.startsWith('@/') || name.startsWith('.')) {
          const base = name.startsWith('@/')
            ? path.join(rootDir, name.slice(2))
            : path.resolve(path.dirname(file), name);
          const resolved = ['.ts', '.tsx', '/index.ts'].map((s) => base + s).find(fs.existsSync);
          assert(resolved, name);
          return load(resolved);
        }
        return require(name);
      },
      module,
      module.exports,
      (callback) => {
        if (file.endsWith('NavigationTabs.tsx') && state.holdNavigation)
          navigationTasks.push(callback);
        else queueMicrotask(callback);
      },
    );
    return module.exports;
  }
  const { NavigationTabs } = load(
    path.join(rootDir, 'features/navigation/components/NavigationTabs.tsx'),
  );
  const render = () => React.act(async () => root.render(React.createElement(NavigationTabs)));
  return {
    state,
    navigation,
    async flushNavigation() {
      await React.act(async () => navigationTasks.splice(0).forEach((callback) => callback()));
    },
    React,
    RN,
    load,
    rootDir,
    document: dom.window.document,
    get tabsProps() {
      return lastTabsProps;
    },
    async mount(width = 390) {
      Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
      root = createRoot(document.getElementById('root'));
      await render();
    },
    render,
    find(label) {
      return [...document.querySelectorAll('[aria-label]')].find(
        (n) => n.getAttribute('aria-label') === label,
      );
    },
    async click(label) {
      const node = this.find(label);
      assert(node, label);
      await React.act(async () => node.click());
    },
    async unmount() {
      if (root) {
        await React.act(async () => root.unmount());
        root = null;
      }
      document.querySelectorAll('[data-destination]').forEach((node) => node.remove());
    },
    close() {
      dom.window.close();
    },
  };
};
