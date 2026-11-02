const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const env = require('./helpers/quickActionWeb.cjs')();
async function resize(width) {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    value: width,
    configurable: true,
  });
  await env.React.act(async () => window.dispatchEvent(new window.Event('resize')));
}
for (const width of [320, 390, 767, 768, 1024, 1200, 1280])
  test(`BF295 Web ${width}: capped bar, focusable trigger, selected tab and resize continuity`, async () => {
    Object.assign(env.state, {
      role: 'OWNER',
      pathname: '/agenda',
      status: 'authenticated',
      bottom: 34,
    });
    await resize(width);
    await env.mount(width);
    try {
      const bar = document.querySelector('[data-testid="bar"]');
      assert.equal(window.getComputedStyle(bar).maxWidth, width >= 768 ? '1200px' : '');
      assert.equal(
        env.tabsProps.screenOptions.tabBarLabelPosition,
        width >= 768 ? 'beside-icon' : 'below-icon',
      );
      assert.equal(env.tabsProps.children.length, 5);
      await env.click('Clientes');
      const trigger = env.find('Acciones rápidas');
      await env.React.act(async () => trigger.focus());
      assert.equal(document.activeElement === trigger, true, 'Trigger receives focus');
      assert.equal(trigger.tagName, 'BUTTON');
      assert.equal(trigger.tabIndex, 0);
      await env.click('Acciones rápidas');
      assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
      const other = width >= 768 ? 390 : 1280;
      await resize(other);
      assert.equal(
        env.tabsProps.screenOptions.tabBarLabelPosition,
        other >= 768 ? 'beside-icon' : 'below-icon',
      );
      assert.equal(env.find('Clientes').getAttribute('aria-selected'), 'true');
      assert.equal(trigger.getAttribute('aria-expanded'), 'true');
      // The existing overlay's Escape and focus-return implementation remains the owner.
      await env.React.act(async () =>
        document.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Escape', bubbles: true })),
      );
      assert.equal(
        document.querySelector('[role="dialog"]') === null,
        true,
        'Escape closes dialog',
      );
      assert.equal(document.activeElement === trigger, true, 'Focus returns to trigger');
    } finally {
      await env.unmount();
    }
  });
after(() => env.close());
