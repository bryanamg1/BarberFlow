// Dedicated real-local Node/SQL tests; excluded from the DB-independent unit glob.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { query } = require('./helpers/local-postgres.cjs');
const { appointmentFixture } = require('./helpers/appointment-fixture.cjs');
const allowed = {
  PENDING: ['CONFIRMED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['CONFIRMED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [],
  CANCELLED: ['CANCELLED'],
  NO_SHOW: ['NO_SHOW'],
};
for (const from of Object.keys(allowed)) {
  for (const to of Object.keys(allowed)) {
    test(`BF147A real DB ${from} -> ${to}`, () => {
      const f = appointmentFixture();
      const ok = allowed[from].includes(to);
      const code = ['PENDING', 'COMPLETED'].includes(to) ? 'PT422' : 'PT409';
      const action = ok ? `SELECT ${f.status(to)};` : f.expect(`PERFORM ${f.status(to)}`, code);
      const result =
        query(`BEGIN;${f.sql} UPDATE public.appointments SET status='${from}' WHERE id='${f.appointment}';
        ${f.identity()} SET LOCAL ROLE authenticated;${action}
        RESET ROLE; SELECT status FROM public.appointments WHERE id='${f.appointment}';ROLLBACK;`);
      assert.equal(result.split('\n').at(-1), ok ? to : from);
    });
  }
}
