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
      DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub','${user}',true); END; $$;
      SET LOCAL ROLE authenticated;
      SELECT jsonb_agg(to_jsonb(slot) ORDER BY slot.start_at) FROM public.get_availability('${business}','${member}','2026-10-14',30) AS slot;
      ROLLBACK;`,
      encoding: 'utf8',
      timeout: 15000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const slots = JSON.parse(result.stdout.trim());
  assert.equal(slots.length, 2);
  for (const slot of slots) {
    assert.deepEqual(Object.keys(slot).sort(), ['available', 'end_at', 'start_at']);
    assert.equal(typeof slot.start_at, 'string');
    assert.equal(typeof slot.end_at, 'string');
    assert.equal(slot.available, true);
  }
  const requests = [];
  const client = createClient('https://synthetic.supabase.co', 'public-test', {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, options) => {
        const url = new URL(input);
        requests.push(url);
        assert.equal(url.pathname, '/rest/v1/rpc/get_availability');
        assert.deepEqual(JSON.parse(options.body), {
          p_business_id: business,
          p_barber_member_id: member,
          p_date: '2026-10-14',
          p_duration_minutes: 30,
        });
        return new Response(JSON.stringify(slots), {
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
    const received = await service.getAvailability(business, {
      barberMemberId: member,
      date: '2026-10-14',
      durationMinutes: 30,
    });
    assert.equal(requests.length, 1);
    assert.deepEqual(received, { data: slots, error: null });
    process.stdout.write(
      'PASS BF144 real SQL slot payload remains compatible with BF142 SDK/repository and BF143 service (mocked HTTP only)\n',
    );
  } finally {
    client.auth.stopAutoRefresh();
  }
}
main().catch((error) => {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
});
