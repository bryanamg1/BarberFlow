/* global __dirname */
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  ts = require('typescript');
const root = path.resolve(__dirname, '../../src/features/appointments');
function load(file, cache = new Map()) {
  const filename = path.resolve(root, file + '.ts');
  if (cache.has(filename)) return cache.get(filename);
  const mod = { exports: {} };
  cache.set(filename, mod.exports);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(
    (name) =>
      name === 'zod'
        ? require(name)
        : load(path.relative(root, path.resolve(path.dirname(filename), name)), cache),
    mod,
    mod.exports,
  );
  return mod.exports;
}
const row = (id, start_at, end_at, extra = {}) => ({
  id,
  business_id: 'b',
  client_id: 'c',
  barber_member_id: 'm',
  start_at,
  end_at,
  status: 'PENDING',
  notes: null,
  created_by: 'u',
  created_at: start_at,
  updated_at: start_at,
  ...extra,
});
module.exports = { load, row };
