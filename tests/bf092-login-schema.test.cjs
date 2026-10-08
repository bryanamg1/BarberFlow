/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const zod = require('zod');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src/features/auth/schemas/login.schema.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const schemaModule = { exports: {} };
vm.runInThisContext(`(function(require, module, exports) {${compiled}\n})`, { filename })(
  (name) => {
    // Any service, repository, SDK or network dependency makes this test fail on import.
    assert.equal(name, 'zod');
    return zod;
  },
  schemaModule,
  schemaModule.exports,
);
const { loginSchema } = schemaModule.exports;
const valid = { email: 'User@example.test', password: 'synthetic-password' };

function expectFieldError(input, field, message) {
  const result = loginSchema.safeParse(input);
  assert.equal(result.success, false);
  assert(result.error.issues.some((issue) => issue.path[0] === field && issue.message === message));
}

test('Valid login produces exactly the email/password output', () => {
  assert.deepEqual(loginSchema.parse(valid), valid);
});

test('Empty and whitespace-only email are rejected with a required-field message', () => {
  for (const email of ['', ' ', '\t\n']) {
    expectFieldError({ ...valid, email }, 'email', 'Ingresa tu correo electrónico.');
  }
});

test('Malformed emails are rejected without attempting account lookup', () => {
  for (const email of [
    'invalid',
    'user@',
    '@example.test',
    'user @example.test',
    'user@example..test',
  ]) {
    expectFieldError({ ...valid, email }, 'email', 'Ingresa un correo electrónico válido.');
  }
});

test('Email is trimmed before validation while preserving letter case and the original input', () => {
  const input = { ...valid, email: ' \tMixedCase@Example.test\n ' };
  assert.deepEqual(loginSchema.parse(input), { ...valid, email: 'MixedCase@Example.test' });
  assert.equal(input.email, ' \tMixedCase@Example.test\n ');
});

test('An empty password is rejected', () => {
  expectFieldError({ ...valid, password: '' }, 'password', 'Ingresa tu contraseña.');
});

test('Significant password spaces, case and Unicode are preserved exactly', () => {
  for (const password of ['  PaSs Word  ', ' ', '\t\n', 'é', 'e\u0301', '🔑']) {
    assert.equal(loginSchema.parse({ ...valid, password }).password, password);
  }
});

test('Login accepts short existing passwords without imposing signup strength rules', () => {
  for (const password of ['a', '1', '!']) {
    assert.equal(loginSchema.parse({ ...valid, password }).password, password);
  }
});

test('Missing and non-string credentials fail without coercion', () => {
  for (const value of [undefined, null, 123, false, {}, [], new String('value')]) {
    expectFieldError({ ...valid, email: value }, 'email', 'Ingresa tu correo electrónico.');
    expectFieldError({ ...valid, password: value }, 'password', 'Ingresa tu contraseña.');
  }
  assert.equal(loginSchema.safeParse({}).success, false);
  for (const input of [undefined, null, false, 123, 'credentials', []]) {
    assert.equal(loginSchema.safeParse(input).success, false);
  }
});

test('Unrelated identity, business and form fields do not enter parsed credentials', () => {
  const input = {
    ...valid,
    role: 'OWNER',
    businessId: 'synthetic',
    rememberMe: true,
    confirmPassword: 'other',
  };
  assert.deepEqual(loginSchema.parse(input), valid);
  assert.equal(input.role, 'OWNER');
});

test('Field errors contain safe messages without rejected credential values', () => {
  const secret = 'synthetic-sensitive-input';
  const result = loginSchema.safeParse({ email: secret, password: { sensitive: secret } });
  assert.equal(result.success, false);
  assert(!JSON.stringify(result.error.issues).includes(secret));
  assert.deepEqual(
    result.error.issues.map((issue) => issue.path),
    [['email'], ['password']],
  );
});

test('Inferred form values match the existing repository credential boundary', () => {
  const virtualFile = path.join(root, 'tests/__bf092_type_contract__.ts');
  const source = `
    import type { LoginFormValues } from '@/features/auth/schemas/login.schema';
    import type { SignInCredentials } from '@/features/auth/repositories/authRepository';
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
      (<T>() => T extends B ? 1 : 2) ? true : false;
    type Assert<T extends true> = T;
    export type FormBoundary = Assert<Equal<LoginFormValues, SignInCredentials>>;
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
  const ambientFiles = fileNames.filter((file) => file.endsWith('.d.ts'));
  const program = ts.createProgram(
    [virtualFile, ...ambientFiles],
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
