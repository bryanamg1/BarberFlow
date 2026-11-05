const test = require('node:test');
const assert = require('node:assert/strict');
const { runtimeConfig, profile } = require('../../../scripts/e2e/auth-control.cjs');
const { manifest } = require('../helpers/environment.cjs');
const { webSpec } = require('../../../scripts/e2e/web.cjs');
const baseline =
  'project_id = "barberflow-e2e-bf305"\njwt_expiry = 3600\nenable_refresh_token_rotation = true\n';

test('Web regression selects exactly session.spec and never auth-session.spec', () => {
  for (const separator of ['/', '\\']) {
    const file = (name) => `tests${separator}e2e${separator}web${separator}${name}.spec.cjs`;
    for (const [mode, expected] of [
      ['web', 'session'],
      ['auth', 'auth-session'],
      ['smoke', 'smoke'],
    ]) {
      for (const name of ['session', 'auth-session', 'smoke'])
        assert.equal(new RegExp(webSpec(mode)).test(file(name)), name === expected);
    }
  }
});
const approved = {
  E2E_ENVIRONMENT_ID: manifest.environmentId,
  E2E_BASE_URL: manifest.baseUrl,
  E2E_ALLOW_DESTRUCTIVE_TESTS: 'true',
  E2E_AUTH_PROFILE: profile.name,
};
test('BF305 Auth control: default configuration is unchanged', () => {
  assert.equal(runtimeConfig(baseline, {}), baseline);
});
test('BF305 Auth control: only the explicit isolated profile changes JWT lifetime', () => {
  assert.equal(runtimeConfig(baseline, approved), baseline.replace('3600', '20'));
});
test('BF305 Auth control: missing flags, other targets and arbitrary profiles fail closed', () => {
  for (const field of Object.keys(approved))
    assert.throws(() => runtimeConfig(baseline, { ...approved, [field]: '' }));
  assert.throws(() => runtimeConfig('jwt_expiry = 120', approved));
});
test('BF305 Auth control: returning to the baseline requires no persistent global setting', () => {
  runtimeConfig(baseline, approved);
  assert.equal(runtimeConfig(baseline, {}), baseline);
});
