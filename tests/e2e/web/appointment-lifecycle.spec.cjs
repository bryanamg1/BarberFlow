const assert = require('node:assert/strict');
const { test: base, expect, accounts, login, caller } = require('../helpers/auth.cjs');
const lifecycle = require('../../../scripts/e2e/appointment-lifecycle.cjs');
const local = require('../../../scripts/e2e/local.cjs');

let caseIndex = 0;
const test = base.extend({
  lifecycleBaseline: [
    async ({ browserName }, run) => {
      assert.equal(browserName, 'chromium');
      if (caseIndex++ > 0) lifecycle.reset(accounts());
      assert.deepEqual(lifecycle.counts(), { clients: 1, services: 1, appointments: 2, sales: 0 });
      await run();
    },
    { auto: true, timeout: 60000 },
  ],
});
test.afterEach(() => local.softReset(accounts()));

const { names, fixtures, fixtureDay, timezone } = lifecycle;
const button = (page, name) => page.getByRole('button', { name, exact: typeof name === 'string' });
const field = (page, name) => page.getByLabel(name, { exact: true });
const at = (day, time) => `${day}T${time}:00+00:00`;
const record = (id) => lifecycle.readRow('appointments', id);
const appointmentRoute = (id) => `/appointments/${id}`;
const dateField = 'Fecha del turno (YYYY-MM-DD)';

async function chooseSlot(page, time) {
  await button(page, new RegExp(`^Horario: [^→]*${time}:00[^→]*→.* · Disponible$`)).click();
}

async function openCreate(page) {
  await button(page, 'Acciones rápidas').click();
  await button(page, 'Nuevo turno').click();
  await expect(page).toHaveURL(/\/appointments\/new$/);
}

async function expectStatus(page, label) {
  await expect(page.getByText(`Estado: ${label}`, { exact: true })).toBeVisible();
}

function payload(id, business = accounts().a.businessId) {
  return { p_business_id: business, p_appointment_id: id };
}

function status(request, id, destination, business) {
  return request('rpc/change_appointment_status', {
    ...payload(id, business),
    p_status: destination,
  });
}

function schedule(request, id, member, start, business) {
  return request('rpc/reschedule_appointment', {
    ...payload(id, business),
    p_barber_member_id: member,
    p_start_at: start,
  });
}

function expectError(response, code, http) {
  assert.deepEqual({ code: response.data.code, status: response.status }, { code, status: http });
}

async function createClient(page) {
  await page.goto('/clients');
  await button(page, 'Crear cliente').click();
  await expect(page).toHaveURL(/\/clients\/new$/);
  await button(page, 'Crear cliente').click();
  await expect(page.getByText('Error: Ingresa el nombre.', { exact: true })).toBeVisible();
  assert.equal(lifecycle.counts().clients, 1);
  await field(page, 'Nombre (obligatorio)').fill(names.created);
  await button(page, 'Crear cliente').click();
  await expect(page).toHaveURL(/\/clients\/[a-f0-9-]{36}$/);
  const id = new URL(page.url()).pathname.split('/').pop();
  const row = lifecycle.readRow('clients', id);
  assert.equal(row.business_id, accounts().a.businessId);
  assert.equal(row.first_name, names.created);
  assert.equal(row.is_active, true);
  await expect(page.getByRole('heading', { name: names.created, exact: true })).toBeVisible();
  return id;
}

async function createService(page) {
  await page.goto('/services');
  await button(page, 'Crear servicio').click();
  await expect(page).toHaveURL(/\/services\/new$/);
  await field(page, 'Nombre (obligatorio)').fill(names.createdService);
  await field(page, 'Precio (obligatorio)').fill('10.50');
  await field(page, 'Duración en minutos (obligatorio)').fill('30');
  await button(page, 'Crear servicio').click();
  await expect(page).toHaveURL(/\/services\/[a-f0-9-]{36}\/edit$/);
  const id = new URL(page.url()).pathname.split('/').at(-2);
  const row = lifecycle.readRow('services', id);
  assert.deepEqual(
    [row.business_id, row.name, row.price, row.duration_minutes, row.is_active],
    [accounts().a.businessId, names.createdService, 10.5, 30, true],
  );
  return id;
}

test('BF304A-01 real client and service create feed the appointment and business-day agenda', async ({
  page,
}) => {
  await login(page, accounts().a);
  const day = lifecycle.today();
  const client = await createClient(page);
  await button(page, 'Volver a clientes').click();
  await expect(page).toHaveURL(/\/clients$/);
  await field(page, 'Buscar clientes').fill(names.created);
  await button(page, /^Ver cliente BF304A Cliente Nuevo/).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${client}$`));
  const service = await createService(page);
  await page.goto('/agenda');
  await openCreate(page);
  await field(page, 'Buscar clientes').fill(names.created);
  await button(page, `Seleccionar cliente: ${names.created}`).click();
  await button(page, /^Seleccionar profesional: Barbero \d+$/).click();
  await button(page, `Agregar servicio: ${names.createdService}`).click();
  await field(page, dateField).fill(day);
  await expect(
    page.getByText(`Zona horaria del negocio: ${timezone}`, { exact: true }),
  ).toBeVisible();
  await chooseSlot(page, '09:00');
  await button(page, 'Crear cita').click();
  await expect(page).toHaveURL(/\/appointments\/[a-f0-9-]{36}$/);
  const id = new URL(page.url()).pathname.split('/').pop();
  const persisted = record(id);
  lifecycle.assertAppointment(persisted, {
    client_id: client,
    barber_member_id: accounts().barber.memberId,
    start_at: at(day, '12:00'),
    end_at: at(day, '12:30'),
    status: 'PENDING',
    service,
    name: names.createdService,
    price: '10.50',
  });
  await expectStatus(page, 'Pendiente');
  await expect(page.getByText(`Cliente: ${names.created}`, { exact: true })).toBeVisible();
  await expect(page.getByText(/^Profesional: Barbero \d+$/)).toBeVisible();
  await expect(page.getByText(names.createdService, { exact: true })).toBeVisible();
  await expect(page.getByText(/^Fecha y hora .*09:00.*09:30/)).toBeVisible();
  await button(page, 'Volver a agenda').click();
  await expect(page).toHaveURL(/\/agenda$/);
  await button(page, /^Turno, .*09:00.*09:30.*Pendiente/).click();
  await expect(page).toHaveURL(new RegExp(`${appointmentRoute(id)}$`));
  assert.deepEqual(record(id), persisted);
  assert.deepEqual(lifecycle.counts(), { clients: 2, services: 2, appointments: 3, sales: 0 });
});

test('BF304A-02 owner edits and archives catalog records without changing appointment history', async ({
  page,
}) => {
  await login(page, accounts().a);
  const historical = record(fixtures.assigned);
  await page.goto(`/clients/${accounts().a.clientId}`);
  await button(page, 'Editar cliente').click();
  await expect(page).toHaveURL(/\/clients\/.*\/edit$/);
  await field(page, 'Apellido').fill('Actualizado');
  await button(page, 'Guardar cambios').click();
  await expect(page).toHaveURL(new RegExp(`/clients/${accounts().a.clientId}$`));
  assert.equal(lifecycle.readRow('clients', accounts().a.clientId).last_name, 'Actualizado');
  await button(page, 'Editar cliente').click();
  await button(page, 'Archivar cliente').click();
  await button(page, 'Confirmar archivo').click();
  await button(page, 'Guardar cambios').click();
  await expect(page).toHaveURL(new RegExp(`/clients/${accounts().a.clientId}$`));
  assert.equal(lifecycle.readRow('clients', accounts().a.clientId).is_active, false);
  await page.goto(`/services/${fixtures.service}/edit`);
  await field(page, 'Nombre (obligatorio)').fill('BF304A Servicio Revisado');
  await field(page, 'Precio (obligatorio)').fill('19.75');
  const updatedService = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/rest/v1/services' &&
      response.request().method() === 'PATCH',
  );
  await button(page, 'Guardar cambios').click();
  assert.equal((await updatedService).ok(), true);
  await expect(button(page, 'Guardar cambios')).toBeDisabled();
  const edited = lifecycle.readRow('services', fixtures.service);
  assert.deepEqual([edited.name, edited.price], ['BF304A Servicio Revisado', 19.75]);
  await button(page, 'Archivar servicio').click();
  await button(page, 'Confirmar archivo').click();
  await expect(button(page, 'Restaurar servicio')).toBeVisible();
  assert.equal(lifecycle.readRow('services', fixtures.service).is_active, false);
  assert.deepEqual(record(fixtures.assigned), historical);
  await page.goto(appointmentRoute(fixtures.assigned));
  await expect(page.getByText(names.service, { exact: true })).toBeVisible();
  await expect(
    page.getByText(`Cliente: ${names.client} Actualizado`, { exact: true }),
  ).toBeVisible();
  await page.goto('/appointments/new');
  await expect(
    page.getByText('No hay servicios activos para seleccionar.', { exact: true }),
  ).toBeVisible();
  await expect(button(page, `Agregar servicio: ${edited.name}`)).toHaveCount(0);
  await expect(button(page, `Seleccionar cliente: ${names.client} Actualizado`)).toHaveCount(0);
  assert.deepEqual(lifecycle.counts(), { clients: 1, services: 1, appointments: 2, sales: 0 });
});

test('BF304A-03 owner confirms, starts, saves notes, and reschedules to an active same-tenant member', async ({
  page,
}) => {
  const request = caller(page);
  await login(page, accounts().a);
  const id = fixtures.assigned;
  await page.goto(appointmentRoute(id));
  await expectStatus(page, 'Pendiente');
  assert.equal((await status(request, id, 'CONFIRMED')).status, 200);
  await page.reload();
  await expectStatus(page, 'Confirmada');
  const confirmed = record(id);
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal((await status(request, id, 'CONFIRMED')).status, 200);
  assert.deepEqual(record(id), confirmed);
  assert.equal((await status(request, id, 'IN_PROGRESS')).status, 200);
  await page.reload();
  await expectStatus(page, 'En curso');
  assert.equal(record(id).status, 'IN_PROGRESS');
  const before = record(id);
  expectError(await status(request, id, 'COMPLETED'), 'PT422', 422);
  expectError(await status(request, id, 'CONFIRMED'), 'PT409', 409);
  assert.deepEqual(record(id), before);
  await expect(button(page, /^Completar cita$/)).toHaveCount(0);
  await expect(button(page, 'Ir al checkout de esta cita')).toBeVisible();
  await button(page, 'Editar cita').click();
  await expect(page).toHaveURL(new RegExp(`${appointmentRoute(id)}/edit$`));
  await field(page, 'Notas').fill('BF304A notas persistidas');
  await button(page, 'Guardar notas').click();
  await expect(page).toHaveURL(new RegExp(`${appointmentRoute(id)}$`));
  assert.equal(record(id).notes, 'BF304A notas persistidas');
  await expect(page.getByText('Notas: BF304A notas persistidas', { exact: true })).toBeVisible();
  await button(page, 'Editar cita').click();
  await button(page, 'Reprogramar cita').click();
  await button(page, 'Seleccionar profesional: Yo').click();
  await field(page, dateField).fill(fixtureDay);
  await chooseSlot(page, '10:00');
  await button(page, 'Guardar reprogramación').click();
  await expect(page).toHaveURL(new RegExp(`${appointmentRoute(id)}$`));
  const rescheduled = record(id);
  lifecycle.assertAppointment(rescheduled, {
    client_id: before.client_id,
    barber_member_id: accounts().a.memberId,
    start_at: at(fixtureDay, '13:00'),
    end_at: at(fixtureDay, '13:30'),
    status: 'IN_PROGRESS',
    service: fixtures.service,
    name: names.service,
    price: '12.50',
  });
  assert.deepEqual(rescheduled.items, before.items);
  assert.equal(rescheduled.notes, 'BF304A notas persistidas');
  assert.equal(lifecycle.counts().appointments, 2);
  expectError(
    await schedule(request, id, accounts().b.memberId, at(fixtureDay, '14:00')),
    '42501',
    403,
  );
  assert.deepEqual(record(id), rescheduled);
});

test('BF304A-04 cancellation and no-show stay terminal, with modal dismissal and preserved history', async ({
  page,
}) => {
  const request = caller(page);
  await login(page, accounts().a);
  for (const [id, action, destination, label] of [
    [fixtures.assigned, 'Cancelar cita', 'CANCELLED', 'Cancelada'],
    [fixtures.unassigned, 'Marcar no asistió', 'NO_SHOW', 'No asistió'],
  ]) {
    const before = record(id);
    await page.goto(appointmentRoute(id));
    await button(page, 'Editar cita').click();
    await field(page, 'Notas').fill('No se guarda');
    await button(page, 'Volver sin guardar').click();
    await expect(page).toHaveURL(new RegExp(`${appointmentRoute(id)}$`));
    assert.deepEqual(record(id), before);
    const trigger = button(page, action);
    await trigger.click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(trigger).toBeFocused();
    assert.deepEqual(record(id), before);
    await trigger.click();
    await button(page, 'Confirmar cambio de estado').click();
    await expectStatus(page, label);
    const terminal = record(id);
    assert.equal(terminal.status, destination);
    assert.deepEqual(terminal.items, before.items);
    await expect(button(page, 'Editar cita')).toHaveCount(0);
    await expect(button(page, 'Ir al checkout de esta cita')).toHaveCount(0);
    await page.goto(`${appointmentRoute(id)}/edit`);
    await expect(page.getByText('Esta cita no permite edición', { exact: true })).toBeVisible();
    expectError(
      await schedule(request, id, terminal.barber_member_id, at(fixtureDay, '14:00')),
      'PT409',
      409,
    );
    expectError(
      await request('rpc/update_appointment_notes', { ...payload(id), p_notes: 'Prohibido' }),
      'PT409',
      409,
    );
    expectError(await status(request, id, 'CONFIRMED'), 'PT409', 409);
    assert.equal((await status(request, id, destination)).status, 200);
    assert.deepEqual(record(id), terminal);
  }
  assert.equal(lifecycle.counts().sales, 0);
});

test('BF304A-05 BARBER can start the assigned appointment directly and cannot move or access another', async ({
  page,
}) => {
  const request = caller(page);
  await login(page, accounts().barber);
  const id = fixtures.assigned;
  await page.goto(appointmentRoute(id));
  await expectStatus(page, 'Pendiente');
  await expect(page.getByText('Profesional: Yo', { exact: true })).toBeVisible();
  assert.equal((await status(request, id, 'IN_PROGRESS')).status, 200);
  await page.reload();
  await expectStatus(page, 'En curso');
  const before = record(id);
  assert.equal(before.status, 'IN_PROGRESS');
  expectError(
    await schedule(request, id, accounts().a.memberId, at(fixtureDay, '14:00')),
    '42501',
    403,
  );
  const other = record(fixtures.unassigned);
  await page.goto(appointmentRoute(other.id));
  await expect(page.getByText('Cita no encontrada', { exact: true })).toBeVisible();
  expectError(await status(request, other.id, 'CONFIRMED'), '42501', 403);
  expectError(
    await schedule(request, other.id, accounts().barber.memberId, at(fixtureDay, '14:00')),
    '42501',
    403,
  );
  assert.deepEqual(record(id), before);
  assert.deepEqual(record(other.id), other);
});

test('BF304A-06 OWNER_B cannot read or mutate foreign appointments or create with foreign IDs', async ({
  page,
}) => {
  const request = caller(page);
  await login(page, accounts().b);
  const target = record(fixtures.assigned);
  await page.goto(appointmentRoute(fixtures.foreign));
  await expectStatus(page, 'Pendiente');
  for (const [table, id] of [
    ['clients', accounts().a.clientId],
    ['services', fixtures.service],
    ['appointments', target.id],
  ]) {
    assert.deepEqual(await request(`${table}?select=id&id=eq.${id}`), { status: 200, data: [] });
  }
  await page.goto(appointmentRoute(target.id));
  await expect(page.getByText('Cita no encontrada', { exact: true })).toBeVisible();
  expectError(await status(request, target.id, 'CONFIRMED'), '42501', 403);
  expectError(
    await schedule(
      request,
      target.id,
      accounts().b.memberId,
      at(fixtureDay, '14:00'),
      accounts().b.businessId,
    ),
    '42501',
    403,
  );
  const badId = local.id('bf304a-foreign-create');
  const foreignCreate = await request('rpc/create_appointment_with_services', {
    ...payload(badId, accounts().b.businessId),
    p_client_id: accounts().a.clientId,
    p_barber_member_id: accounts().b.memberId,
    p_start_at: at(fixtureDay, '14:00'),
    p_service_items: [{ service_id: fixtures.foreignService, quantity: 1 }],
  });
  expectError(foreignCreate, 'PT422', 422);
  assert.equal(record(badId), null);
  const foreignService = await request('rpc/create_appointment_with_services', {
    ...payload(badId, accounts().b.businessId),
    p_client_id: accounts().b.clientId,
    p_barber_member_id: accounts().b.memberId,
    p_start_at: at(fixtureDay, '14:00'),
    p_service_items: [{ service_id: fixtures.service, quantity: 1 }],
  });
  expectError(foreignService, 'PT422', 422);
  assert.equal(record(badId), null);
  assert.deepEqual(record(target.id), target);
});
