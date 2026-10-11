/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/features/clients/services/clientsService.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const operations = ['getById', 'create', 'update'];
const businessId = ' MixedCase-Tenant ';
const clientId = ' MixedCase-Client ';
const secret = 'synthetic-private-payload';
const input = Object.freeze({
  first_name: '  Synthetic  ',
  last_name: null,
  phone: ' arbitrary phone ',
  email: '',
  instagram: ' @Mixed ',
  birth_date: '2000-02-29',
  notes: undefined,
  preferences: '   ',
});
const patch = Object.freeze({ ...input, is_active: false });
const row = Object.freeze({
  id: 'synthetic-id',
  business_id: 'synthetic-business',
  first_name: '  Synthetic  ',
  last_name: null,
  phone: ' arbitrary phone ',
  email: '',
  instagram: ' @Mixed ',
  birth_date: '2000-02-29',
  notes: null,
  preferences: '   ',
  is_active: false,
  created_at: '2026-01-01T00:00:00+00:00',
  updated_at: '2026-01-02T00:00:00.123456+00:00',
});
const messages = {
  CLIENT_NOT_FOUND: 'No se encontró el cliente o no está disponible.',
  NETWORK_ERROR: 'No se pudo conectar con el servicio. Inténtalo nuevamente.',
  CLIENT_ACCESS_DENIED: 'No se pudo acceder al cliente.',
  UNKNOWN_ERROR: 'No se pudo completar la operación del cliente. Inténtalo nuevamente.',
};

function loadService(operation) {
  const calls = [];
  const module = { exports: {} };
  const repository = Object.fromEntries(
    operations.map((method) => [
      method,
      function (...args) {
        assert.equal(this, repository);
        calls.push([method, ...args]);
        return operation(method, ...args);
      },
    ]),
  );
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(
    (name) => {
      // Only repository and pure utilities: no Supabase, SDK, Zod, React or Context.
      if (
        [
          '../utils/clientErrors',
          '../utils/clientListParams',
          '../utils/clientSearchParams',
        ].includes(name)
      ) {
        const helperFile = path.resolve(path.dirname(filename), `${name}.ts`);
        const helper = { exports: {} };
        const code = ts.transpileModule(fs.readFileSync(helperFile, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS },
        }).outputText;
        vm.runInThisContext(`(function(require,module,exports){${code}\n})`, {
          filename: helperFile,
        })(
          (dependency) => {
            assert.equal(dependency, './clientListParams');
            const listFile = path.join(path.dirname(helperFile), 'clientListParams.ts');
            const list = { exports: {} };
            const listCode = ts.transpileModule(fs.readFileSync(listFile, 'utf8'), {
              compilerOptions: { module: ts.ModuleKind.CommonJS },
            }).outputText;
            vm.runInThisContext(`(function(require,module,exports){${listCode}\n})`)(
              () => assert.fail('Pure normalization'),
              list,
              list.exports,
            );
            return list.exports;
          },
          helper,
          helper.exports,
        );
        return helper.exports;
      }
      assert.equal(name, '../repositories/clientsRepository');
      return { clientsRepository: repository };
    },
    module,
    module.exports,
  );
  assert.deepEqual(Object.keys(module.exports), ['clientsService']);
  assert.deepEqual(Object.keys(module.exports.clientsService), [...operations, 'list', 'search']);
  assert.equal(calls.length, 0);
  return { service: module.exports.clientsService, calls };
}
function argsFor(method) {
  return method === 'getById'
    ? [businessId, clientId]
    : method === 'create'
      ? [businessId, input]
      : [businessId, clientId, patch];
}
async function resolve(method, result) {
  const h = loadService(() => Promise.resolve(result));
  const received = await h.service[method](...argsFor(method));
  assert.deepEqual(h.calls, [[method, ...argsFor(method)]]);
  return received;
}
function assertFailure(result, code) {
  assert.deepEqual(result, { data: null, error: { code, message: messages[code] } });
  assert(!JSON.stringify(result).includes(secret));
}

test('BF-112: import is inert and preserves getById/create/update through repository boundary', () => {
  loadService(() => assert.fail('No repository call during import'));
});

for (const method of operations) {
  test(`BF-112: ${method} delegates once with exact IDs/input identity and preserves active/inactive row identity`, async () => {
    for (const is_active of [true, false]) {
      const data = Object.freeze({ ...row, is_active });
      const h = loadService(() =>
        Promise.resolve({ data, error: null, status: 200, count: 9, statusText: secret }),
      );
      const result = await h.service[method](...argsFor(method));
      assert.deepEqual(h.calls, [[method, ...argsFor(method)]]);
      assert.equal(result.data, data);
      assert.deepEqual(Object.keys(result).sort(), ['data', 'error']);
      assert.equal(result.error, null);
      if (method === 'create') assert.equal(h.calls[0][2], input);
      if (method === 'update') assert.equal(h.calls[0][3], patch);
      assert.equal(result.data.birth_date, '2000-02-29');
      assert.equal(result.data.updated_at, row.updated_at);
    }
  });

  test(`BF-112: ${method} successful null has the approved operation-specific error`, async () => {
    assertFailure(
      await resolve(method, { data: null, error: null, status: 200 }),
      method === 'create' ? 'UNKNOWN_ERROR' : 'CLIENT_NOT_FOUND',
    );
  });

  test(`BF-112: ${method} structured errors take priority over data with network priority over access code`, async () => {
    for (const [status, code, expected] of [
      [0, '', 'NETWORK_ERROR'],
      [0, '42501', 'NETWORK_ERROR'],
      [401, 'PGRST301', 'CLIENT_ACCESS_DENIED'],
      [403, 'unrelated', 'CLIENT_ACCESS_DENIED'],
      [400, '42501', 'CLIENT_ACCESS_DENIED'],
      [500, '42501', 'CLIENT_ACCESS_DENIED'],
      [500, 'XX000', 'UNKNOWN_ERROR'],
      [429, 'unrelated', 'UNKNOWN_ERROR'],
      [400, '23505', 'UNKNOWN_ERROR'],
      [406, 'PGRST116', 'UNKNOWN_ERROR'],
    ]) {
      for (const data of [row, null]) {
        const error = {
          code,
          message: secret,
          details: secret,
          hint: secret,
          cause: secret,
          stack: secret,
          metadata: { secret },
        };
        assertFailure(
          await resolve(method, { data, error, status, statusText: secret, count: 1 }),
          expected,
        );
      }
    }
  });

  test(`BF-112: ${method} never reads message/details/hint to classify failures`, async () => {
    for (const [status, code, expected] of [
      [0, '', 'NETWORK_ERROR'],
      [400, '42501', 'CLIENT_ACCESS_DENIED'],
      [500, 'unknown', 'UNKNOWN_ERROR'],
    ]) {
      let technicalReads = 0;
      const error = { code };
      for (const field of ['message', 'details', 'hint', 'cause', 'stack', 'metadata']) {
        Object.defineProperty(error, field, {
          get() {
            technicalReads++;
            return `401 403 42501 Failed to fetch ${secret}`;
          },
        });
      }
      assertFailure(await resolve(method, { data: null, error, status }), expected);
      assert.equal(technicalReads, 0);
    }
  });

  test(`BF-112: ${method} normalizes all unexpected synchronous failures and rejections to UNKNOWN_ERROR`, async () => {
    for (const failure of [
      new Error(secret),
      new TypeError('Failed to fetch ' + secret),
      { status: 0, code: '42501', message: secret },
      secret,
      undefined,
      null,
    ]) {
      for (const synchronous of [true, false]) {
        const h = loadService(() => {
          if (synchronous) throw failure;
          return Promise.reject(failure);
        });
        assertFailure(await h.service[method](...argsFor(method)), 'UNKNOWN_ERROR');
        assert.deepEqual(h.calls, [[method, ...argsFor(method)]]);
      }
    }
  });
}

test('BF-112: no schema revalidation/default completion even for internal input misuse', async () => {
  for (const [method, args] of [
    ['create', [businessId, Object.freeze({ first_name: '   ' })]],
    ['update', [businessId, clientId, Object.freeze({})]],
  ]) {
    const h = loadService(() => Promise.resolve({ data: row, error: null, status: 200 }));
    assert.equal((await h.service[method](...args)).data, row);
    assert.equal(h.calls[0].at(-1), args.at(-1));
    assert.equal(h.calls.length, 1);
  }
});

test('BF-112: exact public types, Promise results, BF-110 inputs and discriminated safe errors', () => {
  const virtualFile = path.join(root, 'tests/__bf112_type_contract__.ts');
  const source = `
    import { clientsService } from '@/features/clients/services/clientsService';
    import type { ClientErrorCode, ClientServiceError, ClientResult, ClientListResult } from '@/features/clients/types/client.types';
    import type { ClientRow } from '@/features/clients/repositories/clientsRepository';
    import type { CreateClientInput, UpdateClientInput } from '@/features/clients/schemas/client.schema';
    type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
    type Assert<T extends true> = T;
    export type API = Assert<Equal<keyof typeof clientsService,'getById'|'create'|'update'|'list'|'search'>>;
    export type GetInput = Assert<Equal<Parameters<typeof clientsService.getById>,[businessId:string,clientId:string]>>;
    export type CreateInput = Assert<Equal<Parameters<typeof clientsService.create>,[businessId:string,input:CreateClientInput]>>;
    export type UpdateInput = Assert<Equal<Parameters<typeof clientsService.update>,[businessId:string,clientId:string,input:UpdateClientInput]>>;
    export type Results = Assert<Equal<{[K in keyof typeof clientsService]:ReturnType<typeof clientsService[K]>},{getById:Promise<ClientResult>;create:Promise<ClientResult>;update:Promise<ClientResult>;list:Promise<ClientListResult>;search:Promise<ClientListResult>}>>;
    export type Codes = Assert<Equal<ClientErrorCode,'CLIENT_NOT_FOUND'|'NETWORK_ERROR'|'CLIENT_ACCESS_DENIED'|'UNKNOWN_ERROR'>>;
    export type Error = Assert<Equal<ClientServiceError,{code:ClientErrorCode;message:string}>>;
    export type Result = Assert<Equal<ClientResult,{data:ClientRow;error:null}|{data:null;error:ClientServiceError}>>;
    function narrow(result:ClientResult) {
      if (result.error === null) {
        const row:ClientRow = result.data;
        return row;
      }
      const empty:null = result.data;
      return empty;
    }
    // @ts-expect-error Success cannot contain null data.
    const emptySuccess:ClientResult = {data:null,error:null};
    // @ts-expect-error No invented inactive error.
    const inactive:ClientErrorCode = 'CLIENT_INACTIVE';
    // @ts-expect-error No technical metadata in errors.
    const metadata:ClientServiceError = {code:'UNKNOWN_ERROR',message:'safe',status:403};
    void narrow;void emptySuccess;void inactive;void metadata;
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
