/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '..');
const id = '00000000-0000-4000-8000-000000002341';
const biz = '00000000-0000-4000-8000-000000002342';
const expense = '00000000-0000-4000-8000-000000002343';
const object = '00000000-0000-4000-8000-000000002344';
const body = (mime = 'image/png', size) => {
  const signature = {
    'image/png': [137, 80, 78, 71, 13, 10, 26, 10],
    'image/jpeg': [255, 216, 255],
    'application/pdf': [37, 80, 68, 70, 45],
  }[mime];
  const bytes = new Uint8Array(size ?? signature.length);
  bytes.set(signature);
  return bytes.buffer;
};
const input = (target = { kind: 'avatar' }, mime = 'image/png') => ({
  target,
  objectUuid: object,
  body: body(mime),
  contentType: mime,
});
function load({ client, repo } = {}) {
  const cache = new Map();
  function module(file) {
    if (cache.has(file)) return cache.get(file);
    const m = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
      (name) => {
        if (name === '@/lib/supabase/client') return { suppressed: undefined, supabase: client };
        if (name === './storageRepository' && repo) return { storageRepository: repo };
        if (name === 'zod') return require('zod');
        assert(name.startsWith('.'), name);
        return module(path.resolve(path.dirname(file), name + '.ts'));
      },
      m,
      m.exports,
    );
    cache.set(file, m.exports);
    return m.exports;
  }
  return (file) => module(path.join(root, 'src/lib/storage', file + '.ts'));
}
function transport(
  response = {
    data: { id: 'sdk-id', path: `${id}/${object}.png`, fullPath: `avatars/${id}/${object}.png` },
    error: null,
  },
  identity = { data: { user: { id } }, error: null },
) {
  const calls = [];
  const api = {};
  for (const method of ['upload', 'remove', 'createSignedUrl'])
    api[method] = (...args) => {
      calls.push([method, ...args]);
      return Promise.resolve(response);
    };
  const client = {
    auth: {
      getUser: async () => {
        calls.push(['getUser']);
        return identity;
      },
    },
    storage: {
      from: (bucket) => {
        calls.push(['from', bucket]);
        return api;
      },
    },
  };
  return {
    calls,
    repo: load({ client })('storageRepository').storageRepository,
    identity,
    response,
  };
}
function service(
  result = { data: { fullPath: `avatars/${id}/${object}.png` }, error: null },
  rejection,
) {
  const calls = [];
  const repo = {};
  for (const method of ['upload', 'remove', 'createSignedUrl'])
    repo[method] = async (...args) => {
      calls.push([method, ...args]);
      if (rejection) throw rejection;
      return result;
    };
  return { calls, service: load({ repo })('storageService').storageService };
}
test('BF234A exact public operation surface, no picker or pointer updates', () => {
  assert.deepEqual(Object.keys(transport().repo), ['upload', 'remove', 'createSignedUrl']);
  assert.deepEqual(Object.keys(service().service), ['upload', 'remove', 'createSignedUrl']);
});
test('BF234A avatar derives identity once, SDK result is preserved, no overwrite', async () => {
  const t = transport();
  const i = input();
  assert.equal(await t.repo.upload(i), t.response);
  assert.deepEqual(t.calls, [
    ['getUser'],
    ['from', 'avatars'],
    [
      'upload',
      `${id}/${object}.png`,
      i.body,
      { contentType: 'image/png', cacheControl: '0', upsert: false },
    ],
  ]);
});
for (const [target, bucket, key] of [
  [{ kind: 'businessLogo', businessId: biz }, 'business-assets', `${biz}/${object}.png`],
  [
    { kind: 'expenseReceipt', businessId: biz, expenseId: expense },
    'receipts',
    `${biz}/${expense}/${object}.png`,
  ],
]) {
  test(`BF234A repository serializes ${target.kind} without actor fields`, async () => {
    const t = transport();
    await t.repo.upload(input(target));
    assert.equal(t.calls.filter((c) => c[0] === 'getUser').length, 0);
    assert.deepEqual(t.calls[0], ['from', bucket]);
    assert.equal(t.calls[1][1], key);
  });
}
test('BF234A repository preserves Auth failure object without uploading', async () => {
  const identity = { data: { user: null }, error: { code: 'auth_error' } };
  const t = transport(undefined, identity);
  assert.equal(await t.repo.upload(input()), identity);
  assert.deepEqual(t.calls, [['getUser']]);
});
test('BF234A repository preserves SDK rejection', async () => {
  const rejection = new Error('synthetic');
  const repo = load({ client: { auth: { getUser: () => Promise.reject(rejection) } } })(
    'storageRepository',
  ).storageRepository;
  await assert.rejects(repo.upload(input()), (e) => e === rejection);
});
test('BF234A remove splits bucket/key and targets exactly one object', async () => {
  const t = transport();
  await t.repo.remove(`avatars/${id}/${object}.png`);
  assert.deepEqual(t.calls, [
    ['from', 'avatars'],
    ['remove', [`${id}/${object}.png`]],
  ]);
});
test('BF234A every signing call uses TTL300, no cached signed URL', async () => {
  const t = transport();
  for (let i = 0; i < 2; i++)
    await t.repo.createSignedUrl(`receipts/${biz}/${expense}/${object}.pdf`);
  assert.equal(t.calls.filter((c) => c[0] === 'createSignedUrl').length, 2);
  assert.deepEqual(t.calls[1], ['createSignedUrl', `${biz}/${expense}/${object}.pdf`, 300]);
});
test('BF234A real SDK HTTP upload transport is local-mocked and exact', async () => {
  const calls = [];
  const client = createClient('https://storage.invalid', 'synthetic-anon', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, options) => {
        calls.push({ url: String(url), options });
        return new Response(
          JSON.stringify({ Id: 'sdk', Key: `business-assets/${biz}/${object}.png` }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    },
  });
  const repo = load({ client })('storageRepository').storageRepository;
  const i = input({ kind: 'businessLogo', businessId: biz });
  const r = await repo.upload(i);
  assert.equal(r.error, null);
  assert.equal(r.data.fullPath, `business-assets/${biz}/${object}.png`);
  assert.equal(calls.length, 1);
  assert.equal(
    new URL(calls[0].url).pathname,
    `/storage/v1/object/business-assets/${biz}/${object}.png`,
  );
  assert.equal(calls[0].options.method, 'POST');
  const headers = new Headers(calls[0].options.headers);
  assert.equal(headers.get('content-type'), 'image/png');
  assert.equal(headers.get('x-upsert'), 'false');
  assert.equal(headers.get('cache-control'), 'max-age=0');
  assert.equal(calls[0].options.body, i.body);
});
for (const [target, mime] of [
  [{ kind: 'avatar' }, 'image/png'],
  [{ kind: 'avatar' }, 'image/jpeg'],
  [{ kind: 'businessLogo', businessId: biz }, 'image/png'],
  [{ kind: 'expenseReceipt', businessId: biz, expenseId: expense }, 'application/pdf'],
]) {
  test(`BF234A service accepts approved ${target.kind}/${mime} bytes`, async () => {
    const t = service();
    const r = await t.service.upload(input(target, mime));
    assert.equal(r.error, null);
    assert.equal(t.calls.length, 1);
  });
}
for (const [label, mutate] of [
  ['MIME mismatch', (i) => ({ ...i, body: body('image/jpeg') })],
  ['empty bytes', (i) => ({ ...i, body: new ArrayBuffer(0) })],
  ['SVG', (i) => ({ ...i, contentType: 'image/svg+xml' })],
  ['GIF', (i) => ({ ...i, contentType: 'image/gif' })],
  ['WebP', (i) => ({ ...i, contentType: 'image/webp' })],
  ['PDF avatar', (i) => ({ ...i, contentType: 'application/pdf', body: body('application/pdf') })],
  ['invalid UUID', (i) => ({ ...i, objectUuid: '../foreign' })],
  ['unknown target', (i) => ({ ...i, target: { kind: 'clientPhoto' } })],
  ['bad business', (i) => ({ ...i, target: { kind: 'businessLogo', businessId: 'bad' } })],
  ['missing expense', (i) => ({ ...i, target: { kind: 'expenseReceipt', businessId: biz } })],
  ['URI instead of bytes', (i) => ({ ...i, body: 'file://synthetic' })],
])
  test(`BF234A rejects ${label} before repository`, async () => {
    const t = service();
    const r = await t.service.upload(mutate(input()));
    assert.equal(r.error.code, 'INVALID_INPUT');
    assert.equal(t.calls.length, 0);
  });
for (const [kind, limit] of [
  ['avatar', 5],
  ['expenseReceipt', 10],
])
  for (const extra of [0, 1]) {
    test(`BF234A ${kind} byte limit ${limit}MiB +${extra}`, async () => {
      const t = service();
      const i = input(kind === 'avatar' ? { kind } : { kind, businessId: biz, expenseId: expense });
      i.body = body('image/png', limit * 1024 * 1024 + extra);
      const r = await t.service.upload(i);
      assert.equal(r.error?.code ?? null, extra ? 'INVALID_INPUT' : null);
      assert.equal(t.calls.length, extra ? 0 : 1);
    });
  }
test('BF234A service strips unknown, audit and forged avatar identity fields', async () => {
  const t = service();
  await t.service.upload({
    ...input(),
    target: { kind: 'avatar', userId: 'foreign', businessId: biz },
    id: 'injected',
    created_by: 'foreign',
    path: 'foreign',
    updated_at: 'now',
  });
  assert.deepEqual(Object.keys(t.calls[0][1]), ['target', 'objectUuid', 'body', 'contentType']);
  assert.deepEqual(t.calls[0][1].target, { kind: 'avatar' });
});
for (const bad of [
  'https://foreign.test/file',
  `avatars/${id}/../${object}.png`,
  `avatars/${id}/%2e%2e/${object}.png`,
  `avatars/${id}/${object}.svg`,
  `avatars/${id}/${object}.pdf`,
  `receipts/${biz}/${object}.png`,
  `receipts/${biz}/${expense}/${object}.pdf/extra`,
  '',
  ' avatars/' + id + '/' + object + '.png',
]) {
  test(`BF234A rejects malformed path ${bad.split('/')[0]}`, async () => {
    const t = service();
    for (const method of ['remove', 'createSignedUrl'])
      assert.equal((await t.service[method](bad)).error.code, 'INVALID_INPUT');
    assert.equal(t.calls.length, 0);
  });
}
test('BF234A receipt removal is denied before any SDK call', async () => {
  const t = service();
  assert.equal(
    (await t.service.remove(`receipts/${biz}/${expense}/${object}.png`)).error.code,
    'ACCESS_DENIED',
  );
  assert.equal(t.calls.length, 0);
});
test('BF234A missing or RLS-filtered delete is not reported as success', async () => {
  const t = service({ data: [], error: null });
  assert.equal((await t.service.remove(`avatars/${id}/${object}.png`)).error.code, 'NOT_FOUND');
});
test('BF234A actual one-object removal succeeds with null data', async () => {
  const t = service({ data: [{ name: `${id}/${object}.png` }], error: null });
  assert.deepEqual(await t.service.remove(`avatars/${id}/${object}.png`), {
    data: null,
    error: null,
  });
});
test('BF234A signing returns only actual transient SDK URL', async () => {
  const t = service({
    data: { signedUrl: 'https://storage.invalid/synthetic', other: 'hidden' },
    error: null,
  });
  assert.deepEqual(await t.service.createSignedUrl(`avatars/${id}/${object}.png`), {
    data: { signedUrl: 'https://storage.invalid/synthetic' },
    error: null,
  });
});
for (const [error, code] of [
  [{ status: 403 }, 'ACCESS_DENIED'],
  [{ status: 400, statusCode: '403' }, 'ACCESS_DENIED'],
  [{ code: '42501' }, 'ACCESS_DENIED'],
  [{ name: 'AuthSessionMissingError' }, 'ACCESS_DENIED'],
  [{ status: 404 }, 'NOT_FOUND'],
  [{ code: 'NoSuchKey' }, 'NOT_FOUND'],
  [{ status: 0 }, 'NETWORK_ERROR'],
  [{ name: 'StorageUnknownError', originalError: new TypeError('synthetic') }, 'NETWORK_ERROR'],
  [{ status: 500 }, 'UNKNOWN_ERROR'],
]) {
  test(`BF234A normalizes structured ${code} without raw details`, async () => {
    const t = service({
      data: null,
      error: { ...error, message: 'synthetic secret', details: 'hidden' },
    });
    const r = await t.service.createSignedUrl(`avatars/${id}/${object}.png`);
    assert.equal(r.error.code, code);
    assert.deepEqual(Object.keys(r.error), ['code', 'message']);
    assert(!JSON.stringify(r).includes('synthetic secret'));
  });
}
test('BF234A unexpected service rejection is safe UNKNOWN_ERROR', async () => {
  const t = service(undefined, new Error('synthetic secret'));
  const r = await t.service.upload(input());
  assert.equal(r.error.code, 'UNKNOWN_ERROR');
  assert(!JSON.stringify(r).includes('synthetic secret'));
});
