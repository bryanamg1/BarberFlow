const assert = require('node:assert/strict'),
  { test, after } = require('node:test'),
  fs = require('node:fs'),
  path = require('node:path');
const env = require('./helpers/quickActionWeb.cjs')();
const sheetModule = env.load(
  path.join(env.rootDir, 'features/navigation/components/QuickActionSheet.tsx'),
);
const Sheet = sheetModule.QuickActionSheet;
let lastSheet;
sheetModule.QuickActionSheet = function TrackedSheet(props) {
  lastSheet = props;
  return env.React.createElement(Sheet, props);
};
const labels = [
  'Nuevo turno',
  'Nuevo cliente',
  'Nueva venta',
  'Nuevo gasto',
  'Ingresar mercadería',
];
const prepare = () => {
  Object.assign(env.state, {
    role: 'OWNER',
    status: 'authenticated',
    pathname: '/agenda',
    userId: 'u',
    businessId: 'b',
    membershipId: 'm',
    focused: true,
    isFetching: false,
    destinationFocus: false,
    holdNavigation: false,
  });
  env.navigation.length = 0;
};
async function open() {
  await env.React.act(async () => env.find('Acciones rápidas').focus());
  await env.click('Acciones rápidas');
}

for (const width of [390, 1400])
  for (const role of ['OWNER', 'BARBER'])
    test(`BF282 real RNWeb ${role}/${width}: modal semantics, exact rows, Escape and focus return`, async () => {
      prepare();
      env.state.role = role;
      await env.mount(width);
      try {
        const trigger = env.find('Acciones rápidas');
        await open();
        const dialog = document.querySelector('[role="dialog"]');
        assert(dialog);
        assert.equal(dialog.getAttribute('aria-modal'), 'true');
        assert.equal(dialog.querySelector('[role="heading"]').textContent, 'Acciones rápidas');
        assert.deepEqual(
          [...dialog.querySelectorAll('[role="button"]')]
            .map((n) => n.getAttribute('aria-label'))
            .filter((x) => x !== 'Cerrar'),
          labels.slice(0, role === 'OWNER' ? 5 : 2),
        );
        assert(dialog.contains(document.activeElement), 'focus is inside real RNWeb modal');
        await env.React.act(async () =>
          document.dispatchEvent(
            new window.KeyboardEvent('keyup', { key: 'Escape', bubbles: true }),
          ),
        );
        assert.equal(document.querySelector('[role="dialog"]'), null);
        assert.equal(document.activeElement, trigger);
        assert.equal(env.find('Agenda').getAttribute('aria-selected'), 'true');
        assert.equal(env.navigation.length, 0);
      } finally {
        await env.unmount();
      }
    });

test('BF282 real portal is removed before navigation and its focus cleanup never overrides destination focus', async () => {
  prepare();
  env.state.destinationFocus = true;
  await env.mount();
  try {
    await open();
    await env.click('Nueva venta');
    assert.equal(env.navigation.length, 1);
    assert.equal(env.navigation[0].target, '/sales/new');
    assert.equal(env.navigation[0].dialogPresent, false);
    assert.equal(document.activeElement?.getAttribute('data-destination'), 'true');
    env.state.pathname = '/sales/new';
    await env.render();
    await Promise.resolve();
    assert.equal(document.activeElement?.getAttribute('data-destination'), 'true');
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally {
    await env.unmount();
  }
});

test('BF282 real Web host closes on role change and rejects both stale actions and currently unauthorized IDs', async () => {
  prepare();
  await env.mount();
  try {
    await open();
    const old = lastSheet.onSelect;
    env.state.role = 'BARBER';
    await env.render();
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await env.React.act(async () => old('NEW_SALE'));
    assert.equal(env.navigation.length, 0);
    await open();
    await env.React.act(async () => lastSheet.onSelect('NEW_PURCHASE'));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(env.navigation.length, 0);
    await open();
    await env.click('Nuevo cliente');
    assert.equal(env.navigation[0].target, '/clients/new');
  } finally {
    await env.unmount();
  }
});

for (const change of ['route', 'role', 'unmount'])
  test(`BF282 queued selection is cancelled by ${change} before navigation`, async () => {
    prepare();
    env.state.holdNavigation = true;
    await env.mount();
    try {
      await open();
      await env.click('Nueva venta');
      assert.equal(document.querySelector('[role="dialog"]'), null);
      assert.equal(env.navigation.length, 0);
      assert.equal(env.find('Acciones rápidas').getAttribute('aria-disabled'), 'true');
      if (change === 'unmount') await env.unmount();
      else {
        if (change === 'route') env.state.pathname = '/clients';
        else env.state.role = 'BARBER';
        await env.render();
      }
      await env.flushNavigation();
      assert.equal(env.navigation.length, 0);
    } finally {
      await env.unmount();
    }
  });

test('BF282 sheet has no router/domain transport/state store or duplicated pathnames', () => {
  const sheet = fs.readFileSync(
    path.join(env.rootDir, 'features/navigation/components/QuickActionSheet.tsx'),
    'utf8',
  );
  assert.doesNotMatch(
    sheet,
    /expo-router|supabase|Repository|Service|useState|zustand|createContext|prefetch|pathname/,
  );
  assert.match(sheet, /<BottomSheet/);
  assert.match(sheet, /onSelect\(action.id\)/);
  const host = fs.readFileSync(
    path.join(env.rootDir, 'features/navigation/components/NavigationTabs.tsx'),
    'utf8',
  );
  for (const route of [
    '/appointments/new',
    '/clients/new',
    '/sales/new',
    '/expenses/new',
    '/purchases/new',
  ])
    assert.equal(host.split("'" + route + "'").length - 1, 1);
  const trigger = fs.readFileSync(
    path.join(env.rootDir, 'features/navigation/components/CenterQuickActionButton.tsx'),
    'utf8',
  );
  assert.doesNotMatch(trigger, /QuickActionSheet|router/);
  assert.doesNotMatch(sheet, /CenterQuickActionButton/);
});
after(() => env.close());
