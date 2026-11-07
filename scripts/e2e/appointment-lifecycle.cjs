const assert = require('node:assert/strict');
const local = require('./local.cjs');

const timezone = 'America/Argentina/Buenos_Aires';
const fixtureDay = '2030-05-06';
const names = {
  client: 'BF304A Cliente',
  created: 'BF304A Cliente Nuevo',
  service: 'BF304A Servicio',
  createdService: 'BF304A Servicio Nuevo',
};
const fixtures = {
  service: local.id('bf304a-service-a'),
  foreignService: local.id('bf304a-service-b'),
  assigned: local.id('bf304a-appointment-assigned'),
  unassigned: local.id('bf304a-appointment-unassigned'),
  foreign: local.id('bf304a-appointment-foreign'),
};

function seed(users) {
  assert.equal(users.a.businessId, local.id('tenant-a'));
  assert.equal(users.b.businessId, local.id('tenant-b'));
  assert.equal(users.barber.memberId, local.id('bf304a-barber-membership-a'));
  assert.equal(users.a.memberId, local.id('membership-a'));
  assert.equal(users.b.memberId, local.id('membership-b'));
  assert.equal(users.a.clientId, local.id('client-a'));
  assert.equal(users.b.clientId, local.id('client-b'));
  assert.equal(users.a.userId, local.id('owner-a'));
  assert.equal(users.b.userId, local.id('owner-b'));
  local.sql(`BEGIN;
    UPDATE public.businesses SET timezone='${timezone}' WHERE id IN ('${users.a.businessId}','${users.b.businessId}');
    UPDATE public.clients SET first_name='${names.client}' WHERE id='${users.a.clientId}';
    INSERT INTO public.business_settings(business_id,appointment_interval_minutes,default_service_buffer_minutes)
      VALUES('${users.a.businessId}',30,0),('${users.b.businessId}',30,0);
    INSERT INTO public.business_hours(business_id,day_of_week,open_time,close_time,is_closed)
      SELECT id,day,'09:00','12:00',false FROM public.businesses CROSS JOIN generate_series(0,6) day
      WHERE id IN ('${users.a.businessId}','${users.b.businessId}');
    INSERT INTO public.services(id,business_id,name,price,duration_minutes)
      VALUES('${fixtures.service}','${users.a.businessId}','${names.service}',12.50,30),
        ('${fixtures.foreignService}','${users.b.businessId}','BF304A Servicio B',17.50,30);
    ${[
      [fixtures.assigned, users.a, users.barber.memberId, fixtures.service, names.service, '12.50'],
      [fixtures.unassigned, users.a, users.a.memberId, fixtures.service, names.service, '12.50'],
      [
        fixtures.foreign,
        users.b,
        users.b.memberId,
        fixtures.foreignService,
        'BF304A Servicio B',
        '17.50',
      ],
    ]
      .map(
        ([id, user, member, service, name, price]) => `
      INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,status,start_at,end_at,created_by)
        VALUES('${id}','${user.businessId}','${user.clientId}','${member}','PENDING','${fixtureDay}T12:00Z','${fixtureDay}T12:30Z','${user.userId}');
      INSERT INTO public.appointment_services(id,appointment_id,service_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,quantity,line_total)
        VALUES('${local.id(`bf304a-line-${id}`)}','${id}','${service}','${name}',${price},30,1,${price});`,
      )
      .join('\n')}
    COMMIT;`);
  assert.deepEqual(counts(), { clients: 1, services: 1, appointments: 2, sales: 0 });
  assert.equal(
    local.sql(`SELECT timezone FROM public.businesses WHERE id='${users.a.businessId}'`),
    timezone,
  );
  assert.equal(local.sql('SELECT count(*) FROM auth.sessions'), '0');
}

function reset(users) {
  local.fullReset();
  local.seed(users);
  seed(users);
}

function counts() {
  const tenant = local.id('tenant-a');
  return JSON.parse(
    local.sql(`SELECT jsonb_build_object(
    'clients',(SELECT count(*) FROM public.clients WHERE business_id='${tenant}'),
    'services',(SELECT count(*) FROM public.services WHERE business_id='${tenant}'),
    'appointments',(SELECT count(*) FROM public.appointments WHERE business_id='${tenant}'),
    'sales',(SELECT count(*) FROM public.sales WHERE business_id='${tenant}'));`),
  );
}

function readRow(table, id) {
  assert.ok(['clients', 'services', 'appointments'].includes(table));
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  const items =
    table === 'appointments'
      ? `||jsonb_build_object('items', COALESCE((
    SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('unit_price_snapshot',s.unit_price_snapshot::text,'line_total',s.line_total::text) ORDER BY s.id)
    FROM public.appointment_services s WHERE s.appointment_id=t.id),'[]'))`
      : '';
  return JSON.parse(
    local.sql(
      `SELECT COALESCE((SELECT to_jsonb(t)${items} FROM public.${table} t WHERE t.id='${id}'),'null');`,
    ),
  );
}

function today() {
  return local.sql(`SELECT (now() AT TIME ZONE '${timezone}')::date;`);
}

function createdAppointment() {
  const id = local.sql(`SELECT id FROM public.appointments
    WHERE business_id='${local.id('tenant-a')}' AND id NOT IN ('${fixtures.assigned}','${fixtures.unassigned}');`);
  return readRow('appointments', id);
}

function assertAppointment(row, expected) {
  assert.equal(row.business_id, local.id('tenant-a'));
  for (const key of ['client_id', 'barber_member_id', 'start_at', 'end_at', 'status'])
    assert.equal(row[key], expected[key]);
  assert.ok(row.created_at && row.updated_at);
  assert.equal(row.items.length, 1);
  const line = row.items[0];
  assert.deepEqual(
    [
      line.appointment_id,
      line.service_id,
      line.service_name_snapshot,
      line.duration_minutes_snapshot,
      line.quantity,
      line.unit_price_snapshot,
      line.line_total,
    ],
    [row.id, expected.service, expected.name, 30, 1, expected.price, expected.price],
  );
}

module.exports = {
  timezone,
  fixtureDay,
  names,
  fixtures,
  seed,
  reset,
  counts,
  readRow,
  today,
  createdAppointment,
  assertAppointment,
};
