/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/features/clients/constants/clientsKeys.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleUnderTest = { exports: {} };
vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(
  () => assert.fail('Pure keys must not import services/repositories/SDK/React/query runtime'),
  moduleUnderTest,
  moduleUnderTest.exports,
);
const { clientsKeys } = moduleUnderTest.exports;

test('BF-113: root/business/detail API remains alongside BF-115 list', () => {
  assert.deepEqual(Object.keys(moduleUnderTest.exports), ['clientsKeys']);
  assert.deepEqual(Object.keys(clientsKeys), ['all', 'byBusiness', 'detail', 'list', 'search']);
  assert.deepEqual(clientsKeys.all, ['clients']);
  assert.equal(clientsKeys.byBusiness.length, 1);
  assert.equal(clientsKeys.detail.length, 2);
});

test('BF-113: exact business and detail hierarchy includes both IDs and only approved segments', () => {
  const prefix = clientsKeys.byBusiness('business-a');
  const detail = clientsKeys.detail('business-a', 'client-1');
  assert.deepEqual(prefix, ['clients', 'business-a']);
  assert.deepEqual(detail, ['clients', 'business-a', 'detail', 'client-1']);
  assert.deepEqual(prefix.slice(0, 1), clientsKeys.all);
  assert.deepEqual(detail.slice(0, 2), prefix);
  assert.deepEqual(clientsKeys.all, ['clients']);
});

test('BF-113: null IDs remain literal key segments in every supported combination', () => {
  assert.deepEqual(clientsKeys.byBusiness(null), ['clients', null]);
  for (const [businessId, clientId] of [
    [null, null],
    ['business-a', null],
    [null, 'client-1'],
  ]) {
    assert.deepEqual(clientsKeys.detail(businessId, clientId), [
      'clients',
      businessId,
      'detail',
      clientId,
    ]);
  }
});

test('BF-113: IDs preserve whitespace/casing/empty strings without validation or fallback', () => {
  for (const businessId of [' business-a ', 'MiXeD', '', '   ', 'detail', 'null']) {
    assert.deepEqual(clientsKeys.byBusiness(businessId), ['clients', businessId]);
    for (const clientId of [' client-1 ', 'MiXeD', '', '   ', 'detail', 'null']) {
      assert.deepEqual(clientsKeys.detail(businessId, clientId), [
        'clients',
        businessId,
        'detail',
        clientId,
      ]);
    }
  }
  assert.notDeepEqual(clientsKeys.byBusiness(null), clientsKeys.byBusiness('null'));
  assert.notDeepEqual(clientsKeys.byBusiness(null), clientsKeys.byBusiness(''));
});

test('BF-113: business and client identities cannot share a detail key across tenants or records', () => {
  assert.notDeepEqual(clientsKeys.byBusiness('business-a'), clientsKeys.byBusiness('business-b'));
  assert.notDeepEqual(
    clientsKeys.detail('business-a', 'client-1'),
    clientsKeys.detail('business-b', 'client-1'),
  );
  assert.notDeepEqual(
    clientsKeys.detail('business-a', 'client-1'),
    clientsKeys.detail('business-a', 'client-2'),
  );
  const keys = [
    clientsKeys.all,
    clientsKeys.byBusiness('business-a'),
    clientsKeys.byBusiness('business-b'),
    clientsKeys.detail('business-a', 'client-1'),
    clientsKeys.detail('business-b', 'client-1'),
    clientsKeys.detail('business-a', 'client-2'),
    clientsKeys.detail(null, 'client-1'),
    clientsKeys.detail('business-a', null),
    clientsKeys.detail(null, null),
  ];
  assert.equal(new Set(keys.map((key) => JSON.stringify(key))).size, keys.length);
});

test('BF-113: repeated calls are deterministic, preserve earlier results and do not freeze arrays', () => {
  const prefix = clientsKeys.byBusiness('business-a');
  const detail = clientsKeys.detail('business-a', 'client-1');
  clientsKeys.detail('business-b', null);
  assert.deepEqual(clientsKeys.byBusiness('business-a'), prefix);
  assert.deepEqual(clientsKeys.detail('business-a', 'client-1'), detail);
  for (const key of [clientsKeys.all, prefix, detail]) assert.equal(Object.isFrozen(key), false);
});

test('BF-113: TypeScript infers exact readonly tuples and nullable arguments without widening', () => {
  const virtualFile = path.join(root, 'tests/__bf113_type_contract__.ts');
  const source = `
    import { clientsKeys } from '@/features/clients/constants/clientsKeys';
    type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true> = T;
    export type API = Assert<Equal<keyof typeof clientsKeys,'all'|'byBusiness'|'detail'|'list'|'search'>>;
    export type Root = Assert<Equal<typeof clientsKeys.all,readonly ['clients']>>;
    export type Business = Assert<Equal<ReturnType<typeof clientsKeys.byBusiness>,readonly ['clients',string|null]>>;
    export type Detail = Assert<Equal<ReturnType<typeof clientsKeys.detail>,readonly ['clients',string|null,'detail',string|null]>>;
    export type BusinessArgs = Assert<Equal<Parameters<typeof clientsKeys.byBusiness>,[businessId:string|null]>>;
    export type DetailArgs = Assert<Equal<Parameters<typeof clientsKeys.detail>,[businessId:string|null,clientId:string|null]>>;
    clientsKeys.byBusiness(null); clientsKeys.detail(null,null);
    clientsKeys.detail('business',null); clientsKeys.detail(null,'client');
    // @ts-expect-error Root tuple is readonly.
    clientsKeys.all.push('clients');
    // @ts-expect-error Business tuple is readonly.
    clientsKeys.byBusiness('business')[1] = 'other';
    // @ts-expect-error Detail tuple is readonly.
    clientsKeys.detail('business','client')[3] = 'other';
    // @ts-expect-error Undefined is not part of the approved ID contract.
    clientsKeys.byBusiness(undefined);
    // @ts-expect-error Both detail arguments are required.
    clientsKeys.detail('business');
    // @ts-expect-error List requires business and normalized params.
    clientsKeys.list();
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) =>
    path.resolve(file) === virtualFile
      ? ts.createSourceFile(file, source, options.target ?? ts.ScriptTarget.Latest, true)
      : original(file, ...args);
  const program = ts.createProgram(
    [virtualFile, ...fileNames.filter((file) => file.endsWith('.d.ts'))],
    { ...options, noEmit: true },
    host,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (file) => file,
      getNewLine: () => '\n',
    }),
  );
});
