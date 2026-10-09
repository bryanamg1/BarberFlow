/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/features/business/services/currentBusinessService.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const userId = 'synthetic-current-user';
const privateText = 'synthetic-private-payload';
const business = {
  id: 'synthetic-business',
  name: 'Synthetic business',
  currency_code: 'ARS',
  timezone: 'America/Argentina/Buenos_Aires',
  is_active: true,
};
const member = (role = 'OWNER', related = business) => ({
  id: `synthetic-membership-${role}`,
  user_id: userId,
  business_id: business.id,
  role,
  is_active: true,
  business: related,
});
const success = (data) => ({ data, error: null, status: 200 });

function loadService(operation) {
  const calls = [];
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename })(
    (name) => {
      // The repository is the only runtime boundary; no direct SDK, Auth, cache or navigation.
      assert.equal(name, '../repositories/businessRepository');
      return {
        businessRepository: {
          getActiveMembershipsByUserId(...args) {
            calls.push(args);
            return operation(...args);
          },
        },
      };
    },
    module,
    module.exports,
  );
  assert.deepEqual(Object.keys(module.exports), ['currentBusinessService']);
  assert.deepEqual(Object.keys(module.exports.currentBusinessService), ['getCurrentBusiness']);
  assert.equal(calls.length, 0, 'No data access on import');
  return { service: module.exports.currentBusinessService, calls };
}

async function resolve(result) {
  const h = loadService(() => Promise.resolve(result));
  const received = await h.service.getCurrentBusiness(userId);
  assert.deepEqual(h.calls, [[userId]], 'Exactly one repository call with the received userId');
  return received;
}

function assertFailure(result, code) {
  assert.deepEqual(Object.keys(result).sort(), ['data', 'error']);
  assert.equal(result.data, null);
  assert.deepEqual(Object.keys(result.error).sort(), ['code', 'message']);
  assert.equal(result.error.code, code);
  assert.equal(typeof result.error.message, 'string');
  assert(result.error.message.length > 0);
  assert(!JSON.stringify(result).includes(privateText));
  assert(!/42501|https?:\/\/|SQL|RLS|policy|stack/i.test(result.error.message));
}

for (const role of ['OWNER', 'BARBER']) {
  test(`BF-101: unique active business preserves membershipId, ${role} and original business`, async () => {
    const membership = member(role);
    const result = await resolve(success([membership]));
    assert.deepEqual(result, {
      data: { membershipId: membership.id, role, business },
      error: null,
    });
    assert.equal(result.data.business, business);
    assert.deepEqual(Object.keys(result.data).sort(), ['business', 'membershipId', 'role']);
  });
}

for (const [data, code, description] of [
  [null, 'UNKNOWN_ERROR', 'null data without an SDK error'],
  [[], 'NO_ACTIVE_MEMBERSHIP', 'no active membership'],
  [[member('BARBER', null)], 'BUSINESS_NOT_RESOLVABLE', 'one null business'],
  [
    [member('OWNER', { ...business, is_active: false })],
    'BUSINESS_INACTIVE',
    'one inactive business',
  ],
]) {
  test(`BF-101: ${description} has an explicit safe result`, async () => {
    assertFailure(await resolve(success(data)), code);
  });
}

for (const [first, second, description] of [
  [member('BARBER'), member('OWNER'), 'two active businesses and different roles'],
  [member('BARBER'), member('OWNER', null), 'active and null business'],
  [
    member('OWNER'),
    member('BARBER', { ...business, is_active: false }),
    'active and inactive business',
  ],
  [member('OWNER', null), member('BARBER', null), 'two null businesses'],
  [
    member('OWNER', { ...business, is_active: false }),
    member('BARBER', { ...business, is_active: false }),
    'two inactive businesses',
  ],
]) {
  test(`BF-101: ${description} is ambiguous in either order without a fallback`, async () => {
    for (const rows of [
      [first, second],
      [second, first],
    ]) {
      assertFailure(await resolve(success(rows)), 'AMBIGUOUS_CURRENT_BUSINESS');
    }
  });
}

test('BF-101: plural ambiguity is resolved before inspecting any business relation', async () => {
  const membership = {
    ...member(),
    get business() {
      assert.fail('Must not inspect business eligibility before cardinality');
    },
  };
  assertFailure(await resolve(success([membership, membership])), 'AMBIGUOUS_CURRENT_BUSINESS');
});

for (const [status, code, expected] of [
  [0, '', 'NETWORK_ERROR'],
  [401, 'PGRST301', 'BUSINESS_ACCESS_DENIED'],
  [403, 'unrelated', 'BUSINESS_ACCESS_DENIED'],
  [400, '42501', 'BUSINESS_ACCESS_DENIED'],
  [500, 'XX000', 'UNKNOWN_ERROR'],
  [429, 'unrelated', 'UNKNOWN_ERROR'],
]) {
  test(`BF-101: structured SDK response ${status}/${code || 'empty code'} maps to ${expected}`, async () => {
    const error = {
      code,
      message: privateText,
      details: privateText,
      hint: privateText,
      cause: privateText,
      metadata: { secret: privateText },
    };
    assertFailure(await resolve({ data: null, error, status }), expected);
  });
}

test('BF-101: SDK error has priority over otherwise resolvable or ambiguous data', async () => {
  for (const data of [[], [member()], [member(), member('BARBER')]]) {
    assertFailure(
      await resolve({ data, error: { code: '42501', message: privateText }, status: 403 }),
      'BUSINESS_ACCESS_DENIED',
    );
  }
});

test('BF-101: error wording cannot impersonate access denial or a network response', async () => {
  assertFailure(
    await resolve({
      data: null,
      error: {
        code: 'unrelated',
        message: '401 403 42501 NetworkError Failed to fetch ' + privateText,
      },
      status: 500,
    }),
    'UNKNOWN_ERROR',
  );
});

test('BF-101: unexpected rejections and synchronous exceptions stay safe UNKNOWN_ERROR', async () => {
  for (const failure of [
    new TypeError(privateText),
    { status: 0, code: '42501' },
    privateText,
    null,
  ]) {
    for (const synchronous of [true, false]) {
      const h = loadService(() => {
        if (synchronous) throw failure;
        return Promise.reject(failure);
      });
      assertFailure(await h.service.getCurrentBusiness(userId), 'UNKNOWN_ERROR');
      assert.deepEqual(h.calls, [[userId]]);
    }
  }
});

test('BF-101: TypeScript exposes exact current data and safely discriminated errors', () => {
  const virtualFile = path.join(root, 'tests/__bf101_type_contract__.ts');
  const source = `
    import { currentBusinessService } from '@/features/business/services/currentBusinessService';
    import type { BusinessMembership } from '@/features/business/repositories/businessRepository';
    import type { CurrentBusiness, CurrentBusinessResult, CurrentBusinessErrorCode, CurrentBusinessServiceError } from '@/features/business/types/business.types';
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
    type Assert<T extends true> = T;
    export type Result = Assert<Equal<ReturnType<typeof currentBusinessService.getCurrentBusiness>, Promise<CurrentBusinessResult>>>;
    export type Business = Assert<Equal<CurrentBusiness['business'], NonNullable<BusinessMembership['business']>>>;
    export type Role = Assert<Equal<CurrentBusiness['role'], BusinessMembership['role']>>;
    export type Id = Assert<Equal<CurrentBusiness['membershipId'], BusinessMembership['id']>>;
    export type ErrorKeys = Assert<Equal<keyof CurrentBusinessServiceError, 'code' | 'message'>>;
    export type Codes = Assert<Equal<CurrentBusinessErrorCode, 'NO_ACTIVE_MEMBERSHIP' | 'AMBIGUOUS_CURRENT_BUSINESS' | 'BUSINESS_NOT_RESOLVABLE' | 'BUSINESS_INACTIVE' | 'NETWORK_ERROR' | 'BUSINESS_ACCESS_DENIED' | 'UNKNOWN_ERROR'>>;
    export type Operations = Assert<Equal<keyof typeof currentBusinessService, 'getCurrentBusiness'>>;
    // @ts-expect-error Resolved business must not be nullable.
    const invalidBusiness: CurrentBusiness['business'] = null;
    void invalidBusiness;
  `;
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const { options, errors, fileNames } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.equal(errors.length, 0);
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) =>
    path.resolve(file) === virtualFile
      ? ts.createSourceFile(file, source, options.target ?? ts.ScriptTarget.Latest, true)
      : originalGetSourceFile(file, ...args);
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
