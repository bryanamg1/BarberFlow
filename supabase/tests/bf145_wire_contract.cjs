/* global __dirname, process */
// Real local SQL producer -> mocked HTTP transport -> installed SDK -> repository -> service.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const user = randomUUID();
  const business = randomUUID();
  const member = randomUUID();
  const clientId = randomUUID();
  const serviceId = randomUUID();
  const requestId = randomUUID();
  const startAt = '2026-10-14T09:00:00Z';
  const items = [{ service_id: serviceId, quantity: 1 }];
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_barberflow',
      'psql',
      '-X',
      '-qAt',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    {
      input: `BEGIN;
      INSERT INTO auth.users(id) VALUES('${user}');
      INSERT INTO public.businesses(id,name,currency_code,timezone) VALUES('${business}','Wire test','ARS','UTC');
      INSERT INTO public.business_members(id,business_id,user_id,role) VALUES('${member}','${business}','${user}','OWNER');
      INSERT INTO public.business_settings(business_id) VALUES('${business}');
      INSERT INTO public.business_hours(business_id,day_of_week,open_time,close_time) VALUES('${business}',3,'09:00','10:00');
      INSERT INTO public.clients(id,business_id,first_name) VALUES('${clientId}','${business}','Wire');
      INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES('${serviceId}','${business}','Wire service',1.01,30);
      DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub','${user}',true); END; $$;
      SET LOCAL ROLE authenticated;
      SELECT public.create_appointment_with_services('${requestId}','${business}','${clientId}','${member}','${startAt}','${JSON.stringify(items)}');
      ROLLBACK;`,
      encoding: 'utf8',
      timeout: 15000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const detail = JSON.parse(result.stdout.trim());
  assert.deepEqual(
    Object.keys(detail).sort(),
    [
      'id',
      'business_id',
      'client_id',
      'barber_member_id',
      'start_at',
      'end_at',
      'status',
      'notes',
      'created_by',
      'created_at',
      'updated_at',
      'appointment_services',
    ].sort(),
  );
  assert.equal(detail.id, requestId);
  assert.equal(detail.created_by, user);
  assert.equal(detail.status, 'PENDING');
  assert.equal(detail.notes, null);
  assert.equal(detail.appointment_services.length, 1);
  assert.deepEqual(
    Object.keys(detail.appointment_services[0]).sort(),
    [
      'id',
      'appointment_id',
      'service_id',
      'service_name_snapshot',
      'unit_price_snapshot',
      'duration_minutes_snapshot',
      'quantity',
      'line_total',
      'created_at',
    ].sort(),
  );
  assert.equal(detail.appointment_services[0].line_total, 1.01);
  const requests = [];
  const client = createClient('https://synthetic.supabase.co', 'public-test', {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, options) => {
        const url = new URL(input);
        requests.push(url);
        assert.equal(url.pathname, '/rest/v1/rpc/create_appointment_with_services');
        assert.deepEqual(JSON.parse(options.body), {
          p_business_id: business,
          p_barber_member_id: member,
          p_appointment_id: requestId,
          p_client_id: clientId,
          p_start_at: startAt,
          p_service_items: items,
        });
        return new Response(JSON.stringify(detail), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  const root = path.resolve(__dirname, '../../src/features/appointments');
  function load(relative) {
    const file = path.resolve(root, relative + '.ts');
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;
    const module = { exports: {} };
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
      (name) => {
        if (name === 'zod') return require('zod');
        if (name === '@/lib/supabase/client') return { supabase: client };
        assert(name.startsWith('.'), name);
        return load(path.relative(root, path.resolve(path.dirname(file), name)));
      },
      module,
      module.exports,
    );
    return module.exports;
  }
  try {
    const service = load('services/appointmentsService').appointmentsService;
    const received = await service.create(business, {
      requestId,
      clientId,
      barberMemberId: member,
      startAt,
      items: [{ serviceId, quantity: 1 }],
    });
    assert.equal(requests.length, 1);
    assert.deepEqual(received, { data: detail, error: null });
    process.stdout.write(
      'PASS BF145 real SQL persisted detail payload remains compatible with BF142 SDK/repository and BF143 service (mocked HTTP only)\n',
    );
  } finally {
    client.auth.stopAutoRefresh();
  }
}
main().catch((error) => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
});
