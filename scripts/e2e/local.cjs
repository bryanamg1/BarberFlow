const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  manifest,
  root,
  workdir,
  privateRoot,
  guard,
  accountGuard,
  resetArguments,
} = require('../../tests/e2e/helpers/environment.cjs');

function exec(file, args, input) {
  try {
    return execFileSync(file, args, {
      cwd: root,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 240000,
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch {
    // SQL/CLI output can contain credentials; never rethrow a child_process Error.
    throw new Error(`E2E ${file === 'docker' ? 'local-container' : 'local-cli'} operation failed`);
  }
}

function cli(args) {
  guard();
  assert.ok(['start', 'stop', 'status', 'db'].includes(args[0]));
  assert.equal(args[args.indexOf('--workdir') + 1], workdir);
  assert.ok(args.includes('--workdir'));
  assert.ok(!args.some((arg) => /^(--linked|--db-url|--project-ref|--network-id)(=|$)/.test(arg)));
  assert.equal(
    fs.readFileSync(path.join(workdir, 'supabase/config.toml'), 'utf8'),
    runtimeConfig(),
  );
  return exec(process.execPath, [
    path.join(root, 'node_modules/supabase/dist/supabase.js'),
    ...args,
  ]);
}

function acquire() {
  guard();
  fs.mkdirSync(privateRoot, { recursive: true });
  const lock = path.join(privateRoot, 'exclusive.lock');
  const fd = fs.openSync(lock, 'wx');
  fs.writeFileSync(fd, String(process.pid));
  return () => {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  };
}

function canonicalFiles() {
  return [
    'config.toml',
    'seed.sql',
    ...fs.readdirSync(path.join(root, 'supabase/migrations')).map((f) => `migrations/${f}`),
  ];
}

function fingerprint() {
  const hash = createHash('sha256');
  for (const file of canonicalFiles().sort()) {
    hash.update(file).update(fs.readFileSync(path.join(root, 'supabase', file)));
  }
  return hash.digest('hex');
}

function runtimeConfig() {
  // Derived config is private. Canonical development config and migrations stay unchanged.
  let config = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
  config = config.replace(/^project_id = .+$/m, `project_id = "${manifest.environmentId}"`);
  for (const [before, after] of [
    [54320, 55430],
    [54321, 55431],
    [54322, 55432],
    [54323, 55433],
    [54324, 55434],
    [54327, 55437],
    [54326, 55436],
    [54325, 55435],
    [54329, 55439],
    [8083, 55443],
  ]) {
    config = config.replaceAll(`= ${before}`, `= ${after}`);
  }
  config = config.replace(/^site_url = .+$/m, `site_url = "${manifest.baseUrl}"`);
  config = config.replace(
    /^additional_redirect_urls = .+$/m,
    `additional_redirect_urls = ["${manifest.authCallback}", "barberflow://auth/recovery"]`,
  );
  for (const section of ['studio', 'analytics', 'edge_runtime', 'realtime', 'storage.vector']) {
    config = config.replace(
      new RegExp(`(\\[${section.replaceAll('.', '\\.')}\\]\\r?\\nenabled = )true`),
      '$1false',
    );
  }
  return require('./auth-control.cjs').runtimeConfig(config);
}

function prepare() {
  guard();
  fs.mkdirSync(path.join(workdir, 'supabase/migrations'), { recursive: true });
  const expected = fs.readdirSync(path.join(root, 'supabase/migrations')).sort();
  const existing = fs.readdirSync(path.join(workdir, 'supabase/migrations')).sort();
  assert.ok(
    existing.every((file) => expected.includes(file)),
    'Unexpected runtime migration',
  );
  for (const file of canonicalFiles().filter((f) => f !== 'config.toml')) {
    fs.copyFileSync(path.join(root, 'supabase', file), path.join(workdir, 'supabase', file));
  }
  fs.writeFileSync(path.join(workdir, 'supabase/config.toml'), runtimeConfig());
  fs.writeFileSync(path.join(workdir, 'canonical.sha256'), fingerprint());
}

function verifyContainer() {
  guard();
  const info = JSON.parse(exec('docker', ['inspect', manifest.dbContainer]))[0];
  assert.equal(info.Config.Labels['com.supabase.cli.project'], manifest.environmentId);
  assert.equal(info.State.Running, true);
  assert.equal(
    fs.readFileSync(path.join(workdir, 'supabase/config.toml'), 'utf8'),
    runtimeConfig(),
  );
  const bindings = info.NetworkSettings.Ports['5432/tcp'];
  assert.ok(bindings.some((binding) => Number(binding.HostPort) === manifest.dbPort));
  assert.equal(fs.readFileSync(path.join(workdir, 'canonical.sha256'), 'utf8'), fingerprint());
  assert.deepEqual(
    fs.readdirSync(path.join(workdir, 'supabase/migrations')).sort(),
    fs.readdirSync(path.join(root, 'supabase/migrations')).sort(),
  );
  // Refuse tampered/stale runtime inputs, even when their config keeps the expected project ID.
  for (const file of canonicalFiles().filter((f) => f !== 'config.toml')) {
    assert.deepEqual(
      fs.readFileSync(path.join(workdir, 'supabase', file)),
      fs.readFileSync(path.join(root, 'supabase', file)),
    );
  }
}

function sql(statement) {
  verifyContainer();
  return exec(
    'docker',
    [
      'exec',
      '-i',
      '-e',
      'PGAPPNAME=bf305-e2e',
      manifest.dbContainer,
      'psql',
      '-X',
      '-q',
      '-At',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    statement,
  );
}

function baseline() {
  const actual = JSON.parse(
    sql(`SELECT json_build_object(
    'users',(SELECT count(*) FROM auth.users),
    'businesses',(SELECT count(*) FROM public.businesses),
    'members',(SELECT count(*) FROM public.business_members),
    'clients',(SELECT count(*) FROM public.clients),
    'sessions',(SELECT count(*) FROM auth.sessions),
    'refreshTokens',(SELECT count(*) FROM auth.refresh_tokens),
    'sales',(SELECT count(*) FROM public.sales),
    'purchases',(SELECT count(*) FROM public.purchases),
    'connections',(SELECT count(*) FROM pg_stat_activity WHERE application_name='bf305-e2e' AND pid<>pg_backend_pid()))`),
  );
  assert.deepEqual(actual, {
    users: 1,
    businesses: 1,
    members: 1,
    clients: 4,
    sessions: 0,
    refreshTokens: 0,
    sales: 0,
    purchases: 0,
    connections: 0,
  });
  return actual;
}

function fullReset() {
  verifyContainer();
  cli(resetArguments());
  verifyContainer();
  baseline();
}

function id(label) {
  const hash = createHash('sha256').update(`${manifest.environmentId}:${label}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

function accounts() {
  return Object.fromEntries(
    ['a', 'b'].map((key) => [
      key,
      {
        userId: id(`owner-${key}`),
        businessId: id(`tenant-${key}`),
        memberId: id(`membership-${key}`),
        clientId: id(`client-${key}`),
        email: `bf305.owner-${key}@example.test`,
        password: randomBytes(24).toString('base64url'),
        clientName: `BF305 Client ${key.toUpperCase()}`,
      },
    ]),
  );
}

function seed(users) {
  for (const [key, user] of Object.entries(users)) {
    accountGuard(user.email);
    const password = literal(user.password);
    sql(`BEGIN;
      INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change_token_new,email_change,raw_app_meta_data,raw_user_meta_data,is_super_admin,is_sso_user,is_anonymous,created_at,updated_at)
      VALUES('00000000-0000-0000-0000-000000000000','${user.userId}','authenticated','authenticated','${user.email}',extensions.crypt(${password},extensions.gen_salt('bf',10)),now(),'','','','','{"provider":"email","providers":["email"]}','{}',false,false,false,now(),now()) ON CONFLICT(id) DO NOTHING;
      INSERT INTO auth.identities(id,provider_id,user_id,identity_data,provider,created_at,updated_at)
      VALUES('${id(`identity-${key}`)}','${user.userId}','${user.userId}','{"sub":"${user.userId}","email":"${user.email}","email_verified":true}','email',now(),now()) ON CONFLICT(id) DO NOTHING;
      INSERT INTO public.profiles(id,first_name,last_name) VALUES('${user.userId}','E2E ${key.toUpperCase()}','Synthetic') ON CONFLICT(id) DO NOTHING;
      INSERT INTO public.businesses(id,name,currency_code,timezone) VALUES('${user.businessId}','BF305 Tenant ${key.toUpperCase()}','ARS','UTC') ON CONFLICT(id) DO NOTHING;
      INSERT INTO public.business_members(id,business_id,user_id,role,is_active) VALUES('${user.memberId}','${user.businessId}','${user.userId}','OWNER',true) ON CONFLICT(id) DO NOTHING;
      INSERT INTO public.clients(id,business_id,first_name) VALUES('${user.clientId}','${user.businessId}','${user.clientName}') ON CONFLICT(id) DO NOTHING;
      COMMIT;`);
    // Idempotent preparation accepts only equivalent rows, including the runtime password.
    assert.equal(
      sql(`SELECT count(*) FROM auth.users u JOIN auth.identities i ON i.user_id=u.id
      JOIN public.profiles p ON p.id=u.id JOIN public.business_members m ON m.user_id=u.id
      JOIN public.businesses b ON b.id=m.business_id JOIN public.clients c ON c.business_id=b.id
      WHERE u.id='${user.userId}' AND u.email='${user.email}' AND u.encrypted_password=extensions.crypt(${password},u.encrypted_password)
      AND i.provider='email' AND i.provider_id=u.id::text AND i.identity_data->>'email'='${user.email}'
      AND b.id='${user.businessId}' AND b.name='BF305 Tenant ${key.toUpperCase()}' AND b.is_active
      AND m.id='${user.memberId}' AND m.role='OWNER' AND m.is_active AND c.id='${user.clientId}' AND c.first_name='${user.clientName}'
      AND (SELECT count(*) FROM public.business_members WHERE user_id=u.id AND is_active)=1`),
      '1',
      'E2E fixture mismatch',
    );
  }
}

function softReset(users) {
  const ids = Object.values(users)
    .map((user) => `'${user.userId}'`)
    .join(',');
  // Coordinator-only reset: no UI logout dependency. Clients must already be closed.
  sql(
    `BEGIN; DELETE FROM auth.refresh_tokens WHERE user_id IN (${ids}); DELETE FROM auth.sessions WHERE user_id IN (${ids}); COMMIT;`,
  );
  assert.equal(sql(`SELECT count(*) FROM auth.sessions WHERE user_id IN (${ids})`), '0');
}

function publicKey() {
  verifyContainer();
  const status = JSON.parse(cli(['status', '--workdir', workdir, '--output', 'json']));
  assert.equal(status.API_URL, manifest.supabaseUrl);
  assert.ok(typeof status.ANON_KEY === 'string');
  return status.ANON_KEY;
}

module.exports = {
  exec,
  cli,
  acquire,
  prepare,
  verifyContainer,
  sql,
  baseline,
  fullReset,
  id,
  accounts,
  seed,
  softReset,
  publicKey,
};
