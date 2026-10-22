const { randomUUID } = require('node:crypto');

function appointmentFixture() {
  const ids = Object.fromEntries(
    [
      'owner',
      'barber',
      'other',
      'business',
      'foreignBusiness',
      'ownerMember',
      'barberMember',
      'client',
      'service',
      'appointment',
    ].map((k) => [k, randomUUID()]),
  );
  const sql = `INSERT INTO auth.users(id) VALUES('${ids.owner}'),('${ids.barber}'),('${ids.other}');
    INSERT INTO public.businesses(id,name,timezone) VALUES('${ids.business}','Appointment concurrency','UTC'),('${ids.foreignBusiness}','Foreign','UTC');
    INSERT INTO public.business_members(id,business_id,user_id,role) VALUES
      ('${ids.ownerMember}','${ids.business}','${ids.owner}','OWNER'),('${ids.barberMember}','${ids.business}','${ids.barber}','BARBER');
    INSERT INTO public.clients(id,business_id,first_name) VALUES('${ids.client}','${ids.business}','Test');
    INSERT INTO public.services(id,business_id,name,price,duration_minutes) VALUES('${ids.service}','${ids.business}','Historical',0,30);
    INSERT INTO public.business_settings(business_id,appointment_interval_minutes,default_service_buffer_minutes) VALUES('${ids.business}',30,0);
    INSERT INTO public.business_hours(business_id,day_of_week,open_time,close_time) VALUES('${ids.business}',3,'09:00','18:00');
    INSERT INTO public.appointments(id,business_id,client_id,barber_member_id,start_at,end_at,status,created_by,updated_at)
      VALUES('${ids.appointment}','${ids.business}','${ids.client}','${ids.barberMember}','2026-10-14T09:00Z','2026-10-14T09:30Z','PENDING','${ids.owner}','2020-01-01Z');
    INSERT INTO public.appointment_services(appointment_id,service_id,service_name_snapshot,unit_price_snapshot,duration_minutes_snapshot,quantity,line_total)
      VALUES('${ids.appointment}','${ids.service}','Historical',0,30,1,0);`;
  const identity = (user = ids.owner) =>
    `SELECT set_config('request.jwt.claim.sub','${user}',true);`;
  const status = (dst) =>
    `public.change_appointment_status('${ids.business}','${ids.appointment}','${dst}')`;
  const expect = (statement, code) =>
    `DO $$ BEGIN ${statement}; RAISE EXCEPTION 'Expected ${code}'; EXCEPTION WHEN SQLSTATE '${code}' THEN NULL; END $$;`;
  return { ...ids, sql, identity, status, expect };
}

module.exports = { appointmentFixture };
