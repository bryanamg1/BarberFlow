const assert = require('node:assert/strict');
const { guard, manifest } = require('../../tests/e2e/helpers/environment.cjs');

const profile = Object.freeze({ name: 'bf305-short-lived', jwtExpiry: 20 });

function runtimeConfig(config, env = process.env) {
  if (env.E2E_AUTH_PROFILE === undefined) return config;
  guard(manifest, env);
  assert.equal(env.E2E_AUTH_PROFILE, profile.name, 'Unknown local Auth profile');
  assert.match(config, /^jwt_expiry = 3600$/m, 'Unexpected baseline Auth configuration');
  return config.replace(/^jwt_expiry = 3600$/m, `jwt_expiry = ${profile.jwtExpiry}`);
}

function observeContainer(local, expectedExpiry) {
  guard();
  const info = JSON.parse(
    local.exec('docker', ['inspect', `supabase_auth_${manifest.environmentId}`]),
  )[0];
  assert.equal(info.Config.Labels['com.supabase.cli.project'], manifest.environmentId);
  assert.equal(info.State.Running, true);
  const env = Object.fromEntries(
    info.Config.Env.map((entry) => {
      const separator = entry.indexOf('=');
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
  // Never serialize the container environment: it includes local signing credentials.
  assert.equal(env.GOTRUE_JWT_EXP, String(expectedExpiry));
  return { jwtExpiry: expectedExpiry };
}

module.exports = { profile, runtimeConfig, observeContainer };
