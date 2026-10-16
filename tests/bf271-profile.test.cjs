/* global __dirname */
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  assert = require('node:assert/strict'),
  { test } = require('node:test'),
  ts = require('typescript'),
  { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '..'),
  user = '00000000-0000-4000-8000-000000000271',
  other = '00000000-0000-4000-8000-000000000272',
  file = '00000000-0000-4000-8000-000000000273';
const row = {
  id: user,
  first_name: '',
  last_name: 'Original',
  phone: null,
  avatar_path: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
function load(mocks = {}) {
  const cache = new Map();
  return function module(relative) {
    const filename = path.isAbsolute(relative)
      ? relative
      : path.join(root, 'src/features/business', relative + '.ts');
    if (cache.has(filename)) return cache.get(filename);
    const m = { exports: {} };
    vm.runInThisContext(
      '(function(require,module,exports){' +
        ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS },
        }).outputText +
        '\n})',
      { filename },
    )(
      (name) => {
        if (name in mocks) return mocks[name];
        if (name === 'zod') return require('zod');
        if (name.startsWith('.')) return module(path.resolve(path.dirname(filename), name + '.ts'));
        throw Error('Unmocked boundary ' + name);
      },
      m,
      m.exports,
    );
    cache.set(filename, m.exports);
    return m.exports;
  };
}
function service(response = { data: row, error: null, status: 200 }) {
  const calls = [];
  const repo = {
    getById: (id) => {
      calls.push(['get', id]);
      return Promise.resolve(response);
    },
    update: (id, input) => {
      calls.push(['update', id, input]);
      return Promise.resolve(response);
    },
  };
  return {
    calls,
    ...load({ '../repositories/profileRepository': { profileRepository: repo } })(
      'services/profileService',
    ),
  };
}
const schema = load()('schemas/profile.schema').profileUpdateSchema;
test('profile schema preserves DB-faithful empty names, whitespace, original phone and null', () => {
  for (const input of [
    { first_name: '' },
    { last_name: '  ' },
    { phone: null },
    { phone: '' },
    { phone: '  local phone  ' },
  ])
    assert.deepEqual(schema.parse(input), input);
});
test('profile schema strips managed/unknown fields, requires recognized defined delta', () => {
  assert.deepEqual(
    schema.parse({
      first_name: ' A ',
      id: other,
      business_id: other,
      email: 'x',
      created_at: 'x',
      updated_at: 'x',
    }),
    { first_name: ' A ' },
  );
  for (const input of [
    {},
    { id: user },
    { phone: undefined },
    { first_name: null },
    { last_name: 12 },
  ])
    assert(!schema.safeParse(input).success);
});
test('avatar path requires canonical avatars UUID key, without URLs or traversal', () => {
  assert(schema.safeParse({ avatar_path: `avatars/${user}/${file}.png` }).success);
  for (const p of [
    'https://host/path',
    `business-assets/${user}/${file}.png`,
    `avatars/${user}/../x.png`,
    `avatars/${user}/${file}.svg`,
    '',
  ])
    assert(!schema.safeParse({ avatar_path: p }).success);
});
test('profile service excludes a foreign avatar path before SDK', async () => {
  const s = service();
  assert.equal(
    (await s.profileService.update(user, { avatar_path: `avatars/${other}/${file}.jpg` })).error
      .code,
    'INVALID_INPUT',
  );
  assert.equal(s.calls.length, 0);
});
test('profile service keeps only approved partial input and exact caller filter', async () => {
  const s = service();
  assert.deepEqual(await s.profileService.update(user, { phone: null, id: other }), {
    data: row,
    error: null,
  });
  assert.deepEqual(s.calls, [['update', user, { phone: null }]]);
});
test('missing or invisible profile is NOT_FOUND, not fabricated bootstrap', async () => {
  assert.equal(
    (await service({ data: null, error: null, status: 200 }).profileService.get(user)).error.code,
    'NOT_FOUND',
  );
});
for (const [status, code, expected] of [
  [0, 'x', 'NETWORK_ERROR'],
  [401, 'x', 'ACCESS_DENIED'],
  [403, 'x', 'ACCESS_DENIED'],
  [400, '42501', 'ACCESS_DENIED'],
  [500, 'x', 'UNKNOWN_ERROR'],
])
  test('profile safe error ' + status + '/' + code, async () => {
    const s = service({ data: null, error: { code, message: 'PRIVATE RAW' }, status });
    const r = await s.profileService.get(user);
    assert.equal(r.error.code, expected);
    assert(!JSON.stringify(r).includes('PRIVATE'));
  });
test('unexpected repository rejection is normalized safely', async () => {
  const s = load({
    '../repositories/profileRepository': {
      profileRepository: { getById: () => Promise.reject(Error('PRIVATE')) },
    },
  })('services/profileService');
  assert.equal((await s.profileService.get(user)).error.code, 'UNKNOWN_ERROR');
});
test('unusable identity/empty update reject without query', async () => {
  const s = service();
  assert.equal((await s.profileService.get(' ')).error.code, 'ACCESS_DENIED');
  assert.equal((await s.profileService.update(user, {})).error.code, 'INVALID_INPUT');
  assert.equal(s.calls.length, 0);
});
test('repository normal SDK GET/PATCH explicit projection, self filter, no auth metadata request', async () => {
  const requests = [];
  const client = createClient('https://transport.example.test', 'anonymous-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url, init) => {
        requests.push({ url: String(url), method: init.method, body: init.body });
        return new Response(JSON.stringify([row]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  const repo = load({ '@/lib/supabase/client': { supabase: client } })(
    'repositories/profileRepository',
  ).profileRepository;
  const read = await repo.getById(user);
  assert.deepEqual(read.data, row);
  const write = await repo.update(user, { first_name: ' A ', id: other, created_at: 'x' });
  assert.deepEqual(write.data, row);
  assert.equal(requests.length, 2);
  for (const r of requests) {
    const u = new URL(r.url);
    assert.equal(u.pathname, '/rest/v1/profiles');
    assert.equal(u.searchParams.get('id'), 'eq.' + user);
    assert.equal(
      u.searchParams.get('select'),
      'id,first_name,last_name,phone,avatar_path,created_at,updated_at',
    );
  }
  assert.equal(requests[1].method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[1].body), { first_name: ' A ' });
});
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
function picker(result, reader = async () => png) {
  const calls = [];
  const p = load({
    'expo-image-picker': {
      UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' },
      launchImageLibraryAsync: async (options) => {
        calls.push(options);
        if (result instanceof Error) throw result;
        return result;
      },
    },
    './avatarFile': { readAvatarFile: reader },
    './profileService': { profileError: (code) => ({ code, message: 'Safe ' + code }) },
  })('services/avatarPicker').avatarPicker;
  return { calls, p };
}
for (const mime of ['image/jpeg', 'image/png'])
  test(
    'picker ' + mime + ' uses one scoped original selection without broad permissions/editing',
    async () => {
      const s = picker({
        canceled: false,
        assets: [{ mimeType: mime, fileSize: 5 * 1024 * 1024, uri: 'file:///picked' }],
      });
      const r = await s.p.pick();
      assert.equal(r.status, 'selected');
      assert.equal(r.contentType, mime);
      assert.equal(r.body, png);
      assert.deepEqual(s.calls, [
        {
          mediaTypes: ['images'],
          allowsEditing: false,
          allowsMultipleSelection: false,
          preferredAssetRepresentationMode: 'current',
        },
      ]);
    },
  );
test('cancel does not read any file', async () => {
  const r = await picker({ canceled: true, assets: null }, () => {
    throw Error('must not read');
  }).p.pick();
  assert.deepEqual(r, { status: 'cancelled' });
});
for (const mime of [
  'image/heic',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  undefined,
])
  test('unsupported picker MIME ' + mime, async () => {
    let reads = 0;
    const r = await picker(
      { canceled: false, assets: [{ mimeType: mime, uri: 'file:///fake.jpg' }] },
      () => {
        reads++;
        return png;
      },
    ).p.pick();
    assert.equal(r.error.code, 'INVALID_INPUT');
    assert.equal(reads, 0);
  });
test('known oversized selection never reads bytes', async () => {
  const r = await picker(
    { canceled: false, assets: [{ mimeType: 'image/png', fileSize: 5 * 1024 * 1024 + 1 }] },
    () => {
      throw Error('must not read');
    },
  ).p.pick();
  assert.equal(r.error.code, 'INVALID_INPUT');
});
test('actual oversized bytes rejected even if metadata understated', async () => {
  const r = await picker(
    { canceled: false, assets: [{ mimeType: 'image/png', fileSize: 1 }] },
    async () => new ArrayBuffer(5 * 1024 * 1024 + 1),
  ).p.pick();
  assert.equal(r.error.code, 'INVALID_INPUT');
});
for (const code of [
  'ERR_USER_REJECTED_PERMISSIONS',
  'E_MISSING_PERMISSION',
  'ERR_MISSING_PERMISSION',
  'E_PERMISSION_MISSING',
])
  test('coded denied permission ' + code, async () => {
    const e = Object.assign(Error('PRIVATE NATIVE ERROR'), { code });
    const r = await picker(e).p.pick();
    assert.equal(r.error.code, 'ACCESS_DENIED');
    assert(!JSON.stringify(r).includes('PRIVATE'));
  });
test('native failure yields safe UNKNOWN_ERROR', async () => {
  const r = await picker(Error('PRIVATE URI')).p.pick();
  assert.equal(r.error.code, 'UNKNOWN_ERROR');
  assert(!JSON.stringify(r).includes('PRIVATE'));
});
test('Web reads browser File directly without URI requests', async () => {
  const read = load()('services/avatarFile').readAvatarFile;
  assert.deepEqual(
    await read(
      { uri: 'https://untrusted.invalid', file: { size: 8, arrayBuffer: async () => png } },
      1024,
    ),
    png,
  );
  await assert.rejects(read({ uri: 'https://untrusted.invalid' }, 1024));
  await assert.rejects(read({ file: { size: 1025 } }, 1024), RangeError);
});
test('native FileSystem reads original bytes, rejects network URIs and large files before allocation', async () => {
  const seen = [];
  class File {
    constructor(uri) {
      seen.push(uri);
      this.size = 8;
    }
    arrayBuffer() {
      return Promise.resolve(png);
    }
  }
  const read = load({ 'expo-file-system': { File } })('services/avatarFile.native').readAvatarFile;
  assert.equal(await read({ uri: 'file:///picked.png' }, 8), png);
  assert.deepEqual(seen, ['file:///picked.png']);
  await assert.rejects(read({ uri: 'https://untrusted.invalid/a' }, 8));
  await assert.rejects(read({ uri: 'content://picked' }, 7), RangeError);
});
