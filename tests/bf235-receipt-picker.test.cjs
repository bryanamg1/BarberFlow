/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, dependencies) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const m = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(
    (name) => {
      assert(name in dependencies, name);
      return dependencies[name];
    },
    m,
    m.exports,
  );
  return m.exports;
}
const asset = (mimeType = 'application/pdf') => ({
  uri: 'file:///cache/receipt.pdf',
  name: 'receipt.pdf',
  mimeType,
  size: 5,
});
function picker(result, bytes = new Uint8Array([37, 80, 68, 70, 45]).buffer) {
  const calls = [];
  const api = load('src/features/expenses/services/receiptPicker.ts', {
    'expo-document-picker': {
      getDocumentAsync: async (options) => {
        calls.push(options);
        if (result instanceof Error) throw result;
        return result;
      },
    },
    './receiptFile': {
      readReceiptFile: async () => {
        calls.push('read');
        return bytes;
      },
    },
  });
  return { pick: api.receiptPicker.pick, calls };
}
for (const mime of ['application/pdf', 'image/jpeg', 'image/png'])
  test(`BF235 picker accepts ${mime} with exact types/single/cache options`, async () => {
    const p = picker({ canceled: false, assets: [asset(mime)] });
    const result = await p.pick();
    assert.equal(result.status, 'selected');
    assert.equal(result.file.contentType, mime);
    assert.deepEqual(p.calls[0], {
      type: ['application/pdf', 'image/jpeg', 'image/png'],
      multiple: false,
      copyToCacheDirectory: true,
      base64: false,
    });
  });
for (const [name, changes] of Object.entries({
  unsupported: { mimeType: 'image/svg+xml' },
  missingType: { mimeType: undefined },
  unknownSize: { size: undefined },
  tooLarge: { size: 10 * 1024 * 1024 + 1 },
  zero: { size: 0 },
  negative: { size: -1 },
  noUri: { uri: '' },
}))
  test(`BF235 rejects ${name} before reading/uploading`, async () => {
    const p = picker({ canceled: false, assets: [{ ...asset(), ...changes }] });
    assert.equal((await p.pick()).status, 'error');
    assert.equal(p.calls.length, 1);
  });
test('BF235 picker cancellation is harmless', async () => {
  const p = picker({ canceled: true, assets: null });
  assert.deepEqual(await p.pick(), { status: 'cancelled' });
  assert.equal(p.calls.length, 1);
});
test('BF235 picker rejection returns safe error, not original data', async () => {
  const p = picker(new Error('secret local path'));
  const result = await p.pick();
  assert.equal(result.status, 'error');
  assert(!JSON.stringify(result).includes('secret'));
});
test('BF235 byte-size mismatch rejected', async () => {
  const p = picker({ canceled: false, assets: [asset()] }, new ArrayBuffer(4));
  assert.equal((await p.pick()).status, 'error');
});
test('BF235 display name excludes path fragments/control/bidi characters', async () => {
  const p = picker({
    canceled: false,
    assets: [{ ...asset(), name: '/private/path/a\u202e\n.pdf' }],
  });
  assert.equal((await p.pick()).file.name, 'a.pdf');
});
test('BF235 Web reads selected File only, not URI fetch', async () => {
  const { readReceiptFile } = load('src/features/expenses/services/receiptFile.ts', {});
  const body = new ArrayBuffer(5);
  assert.equal(
    await readReceiptFile({ file: { size: 5, arrayBuffer: async () => body } }, 10),
    body,
  );
  await assert.rejects(readReceiptFile({ uri: 'https://untrusted.test' }, 10));
});
test('BF235 native reads existing bounded local file only', async () => {
  let reads = 0;
  const { readReceiptFile } = load('src/features/expenses/services/receiptFile.native.ts', {
    'expo-file-system': {
      File: class {
        exists = true;
        size = 5;
        async arrayBuffer() {
          reads++;
          return new ArrayBuffer(5);
        }
      },
    },
  });
  await assert.rejects(readReceiptFile({ uri: 'https://untrusted.test/file' }, 10));
  await assert.rejects(readReceiptFile({ uri: 'file:///cache/f' }, 4));
  assert.equal(reads, 0);
  assert.equal((await readReceiptFile({ uri: 'file:///cache/f' }, 10)).byteLength, 5);
});
