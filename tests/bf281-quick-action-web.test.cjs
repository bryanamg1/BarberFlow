const assert = require('node:assert/strict'),
  { test, after } = require('node:test');
const env = require('./helpers/quickActionWeb.cjs')();
for (const width of [390, 1400])
  for (const role of ['OWNER', 'BARBER'])
    test(`BF281 real RNWeb ${role}/${width}: accessible FAB, toggle and current tab`, async () => {
      Object.assign(env.state, { role, status: 'authenticated', pathname: '/agenda', bottom: 34 });
      env.navigation.length = 0;
      await env.mount(width);
      try {
        const trigger = env.find('Acciones rápidas');
        assert(trigger);
        assert.equal(trigger.getAttribute('role'), 'button');
        assert.equal(trigger.getAttribute('aria-expanded'), 'false');
        assert.equal(trigger.getAttribute('href'), null);
        assert.equal(trigger.getAttribute('aria-selected'), null);
        const css = window.getComputedStyle(trigger);
        assert.equal(css.width, '56px');
        assert.equal(css.height, '56px');
        assert.equal(css.transform, '');
        const labels = [...document.querySelectorAll('[role="tab"],[role="button"]')].map((n) =>
          n.getAttribute('aria-label'),
        );
        assert.deepEqual(labels, ['Inicio', 'Agenda', 'Acciones rápidas', 'Clientes', 'Finanzas']);
        await env.click('Acciones rápidas');
        assert.equal(trigger.getAttribute('aria-expanded'), 'true');
        await env.click('Acciones rápidas');
        assert.equal(trigger.getAttribute('aria-expanded'), 'false');
        assert.equal(env.find('Agenda').getAttribute('aria-selected'), 'true');
        assert.equal(env.navigation.length, 0);
        assert.equal(env.tabsProps.screenOptions.tabBarStyle.height, 114);
      } finally {
        await env.unmount();
      }
    });

test('BF281 Web uses a keyboard-focusable native button and preserves focus during activation', async () => {
  await env.mount();
  try {
    const trigger = env.find('Acciones rápidas');
    await env.React.act(async () => {
      trigger.focus();
    });
    assert.equal(trigger.tagName, 'BUTTON');
    assert.equal(trigger.tabIndex, 0);
    assert.equal(document.activeElement, trigger);
    // JSDOM does not perform a native button's trusted keyboard default click.
    // Exercise that activation separately; do not add a duplicate key handler.
    await env.click('Acciones rápidas');
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(env.navigation.length, 0);
  } finally {
    await env.unmount();
  }
});
test('BF281 Web route change closes trigger and invalid context removes it', async () => {
  await env.mount();
  try {
    await env.click('Acciones rápidas');
    env.state.pathname = '/clients';
    await env.render();
    assert.equal(env.find('Acciones rápidas').getAttribute('aria-expanded'), 'false');
    env.state.status = 'unauthenticated';
    await env.render();
    assert.equal(env.find('Acciones rápidas'), undefined);
  } finally {
    await env.unmount();
  }
});
after(() => env.close());
