/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const feature = path.join(root, 'src/features/services');
function compile(
  file,
  requireModule = () => assert.fail('Pure module has no runtime dependencies'),
) {
  const filename = path.join(feature, file + '.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    requireModule,
    module,
    module.exports,
  );
  return module.exports;
}
const { servicesKeys: keys } = compile('constants/servicesKeys');
const { normalizeServiceListParams: normalize } = compile('utils/serviceListParams');

test('BF-132 exact root/business/detail keys preserve original and null IDs without user/role', () => {
  assert.deepEqual(Object.keys(keys), ['all', 'byBusiness', 'detail', 'list']);
  assert.deepEqual(keys.all, ['services']);
  assert.deepEqual(keys.byBusiness(null), ['services', null]);
  assert.deepEqual(keys.byBusiness(' Original B '), ['services', ' Original B ']);
  assert.deepEqual(keys.detail(' Original B ', ' Original S '), [
    'services',
    ' Original B ',
    'detail',
    ' Original S ',
  ]);
  assert.deepEqual(keys.detail(null, null), ['services', null, 'detail', null]);
});
test('BF-132 normalized defaults and explicit defaults have identical list keys', () => {
  const expected = ['services', 'b', 'list', { page: 1, pageSize: 25, status: 'active' }];
  for (const params of [
    undefined,
    {},
    { page: 1 },
    { pageSize: 25, status: 'active' },
    { page: 1, pageSize: 25, status: 'active' },
  ]) {
    assert.deepEqual(keys.list('b', normalize(params)), expected);
  }
});
test('BF-132 keys isolate tenant/service/page/status/pageSize and descend only their business prefix', () => {
  const defaults = normalize();
  const key = keys.list('b', defaults);
  for (const candidate of [
    keys.list('b2', defaults),
    keys.list('b', { ...defaults, page: 2 }),
    keys.list('b', { ...defaults, status: 'inactive' }),
    keys.list('b', { ...defaults, status: 'all' }),
    keys.list('b', { ...defaults, pageSize: 7 }),
  ])
    assert.notDeepEqual(candidate, key);
  assert.notDeepEqual(keys.detail('b', 's'), keys.detail('b', 's2'));
  assert.notDeepEqual(keys.detail('b', 's'), keys.detail('b2', 's'));
  assert.deepEqual(keys.detail('b', 's').slice(0, 2), keys.byBusiness('b'));
  assert.deepEqual(key.slice(0, 2), keys.byBusiness('b'));
});
test('BF-132 list key snapshots allowlisted parameters rather than caller object reference', () => {
  const params = { ...normalize(), unknown: 'not-in-key' };
  const key = keys.list('b', params);
  params.page = 99;
  assert.deepEqual(key, ['services', 'b', 'list', { page: 1, pageSize: 25, status: 'active' }]);
});
test('BF-132 hook modules import only context/service/query/pure helpers, with no runtime repository or navigation', () => {
  const allowed = new Set([
    '@tanstack/react-query',
    '@/features/business/context/BusinessContext',
    '../constants/servicesKeys',
    '../services/servicesService',
    '../utils/serviceListParams',
    './serviceHookUtils',
  ]);
  for (const name of [
    'useServiceDetail',
    'useServiceList',
    'useCreateService',
    'useUpdateService',
  ]) {
    const exports = compile('hooks/' + name, (dependency) => {
      assert(allowed.has(dependency), dependency);
      return {};
    });
    assert.deepEqual(Object.keys(exports), [name]);
  }
});
test('BF-132 TypeScript exposes readonly tuples and precise query/mutation input/result contracts', () => {
  const virtualFile = path.join(root, 'tests/__bf132_type_contract__.ts');
  const source = `
    import { servicesKeys } from '@/features/services/constants/servicesKeys';
    import { useServiceDetail } from '@/features/services/hooks/useServiceDetail';
    import { useServiceList } from '@/features/services/hooks/useServiceList';
    import { useCreateService } from '@/features/services/hooks/useCreateService';
    import { useUpdateService } from '@/features/services/hooks/useUpdateService';
    import type { UseServiceDetailResult,UseServiceListResult,ServiceMutationResult,UpdateServiceVariables } from '@/features/services/hooks/serviceHook.types';
    import type { CreateServiceInput } from '@/features/services/schemas/service.schema';
    import type { ServiceListParams } from '@/features/services/types/service.types';
    type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true>=T;
    export type Root=Assert<Equal<typeof servicesKeys.all,readonly ['services']>>;
    export type Business=Assert<Equal<ReturnType<typeof servicesKeys.byBusiness>,readonly ['services',string|null]>>;
    export type Detail=Assert<Equal<ReturnType<typeof servicesKeys.detail>,readonly ['services',string|null,'detail',string|null]>>;
    export type List=Assert<Equal<ReturnType<typeof servicesKeys.list>,readonly ['services',string|null,'list',Readonly<Required<ServiceListParams>>]>>;
    export type DetailResult=Assert<Equal<ReturnType<typeof useServiceDetail>,UseServiceDetailResult>>;
    export type ListResult=Assert<Equal<ReturnType<typeof useServiceList>,UseServiceListResult>>;
    export type CreateResult=Assert<Equal<ReturnType<typeof useCreateService>,ServiceMutationResult<CreateServiceInput>>>;
    export type UpdateResult=Assert<Equal<ReturnType<typeof useUpdateService>,ServiceMutationResult<UpdateServiceVariables>>>;
    // @ts-expect-error Keys cannot be pushed into.
    servicesKeys.all.push('tenant');
    // @ts-expect-error Query inputs cannot accept arbitrary business IDs as a second argument.
    useServiceDetail('service','foreign-business');
    // @ts-expect-error List params cannot accept a tenant injection.
    useServiceList({businessId:'foreign'});
    // @ts-expect-error Input cannot write tenant ownership.
    const mutation:UpdateServiceVariables={serviceId:'s',input:{business_id:'foreign'}};
    void mutation;
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const { options, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const host = ts.createCompilerHost(options),
    getSource = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) =>
    path.resolve(file) === virtualFile
      ? ts.createSourceFile(file, source, options.target ?? ts.ScriptTarget.Latest, true)
      : getSource(file, ...args);
  const program = ts.createProgram(
    [virtualFile, ...fileNames.filter((f) => f.endsWith('.d.ts'))],
    { ...options, noEmit: true },
    host,
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (f) => f,
      getNewLine: () => '\n',
    }),
  );
});
