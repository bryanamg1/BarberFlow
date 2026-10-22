/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const file = path.resolve(__dirname, '../src/features/appointments/constants/appointmentsKeys.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const mod = { exports: {} };
vm.runInThisContext(`(function(module,exports){${compiled}\n})`, { filename: file })(
  mod,
  mod.exports,
);
const { appointmentsKeys: k } = mod.exports;
const scope = { businessId: 'b', userId: 'u', membershipId: 'm', role: 'OWNER' };
test('BF146 keys isolate business, user, membership and role', () => {
  const original = k.detail(scope, 'a');
  for (const field of Object.keys(scope))
    assert.notDeepEqual(k.detail({ ...scope, [field]: 'other' }, 'a'), original);
  assert.deepEqual(k.scope(scope), ['appointments', 'b', scope]);
});
test('BF146 range keys preserve exact original zoned strings and both endpoints', () => {
  const range = { from: '2026-10-22T09:00:00-03:00', to: '2026-10-22T10:00:00-03:00' };
  assert.deepEqual(k.list(scope, range).at(-1), range);
  assert.notDeepEqual(
    k.list(scope, range),
    k.list(scope, { ...range, to: '2026-10-22T11:00:00-03:00' }),
  );
});
test('BF146 availability keys include all actual server parameters', () => {
  const params = {
    barberMemberId: 'm',
    date: '2026-10-22',
    durationMinutes: 30,
    excludeAppointmentId: 'a',
  };
  for (const field of Object.keys(params))
    assert.notDeepEqual(
      k.availability(scope, params),
      k.availability(scope, { ...params, [field]: 'changed' }),
    );
  assert.deepEqual(k.availability(null, null), ['appointments', null, null, 'availability', null]);
});
test('BF146 exact hooks remain behind service and never import direct data access', () => {
  const dir = path.resolve(__dirname, '../src/features/appointments/hooks');
  for (const name of [
    'useAppointments',
    'useAppointmentDetail',
    'useAvailability',
    'useCreateAppointment',
    'useRescheduleAppointment',
    'useUpdateAppointmentNotes',
    'useAppointmentStatusAction',
  ]) {
    const source = fs.readFileSync(path.join(dir, name + '.ts'), 'utf8');
    assert.match(source, new RegExp(`export function ${name}\\(`));
    assert.match(source, /appointmentsService/);
    assert.doesNotMatch(
      source,
      /supabase|Repository|process\.env|from ['"].*features\/(sales|products)/,
    );
  }
});
