import { zodResolver } from '@hookform/resolvers/zod';
import { uuid } from 'expo-modules-core';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { businessProfileSchema } from '@/features/business/schemas/businessSettings.schema';
import { useClientDetail } from '@/features/clients/hooks/useClientDetail';
import { theme } from '@/theme';
import { AppointmentClientSelector } from '../components/AppointmentClientSelector';
import { AppointmentDateField } from '../components/AppointmentDateField';
import { AppointmentDuration } from '../components/AppointmentDuration';
import { AppointmentNotesField } from '../components/AppointmentNotesField';
import { AppointmentProfessionalField } from '../components/AppointmentProfessionalField';
import { AppointmentServiceSelector } from '../components/AppointmentServiceSelector';
import { AppointmentSlotSelector } from '../components/AppointmentSlotSelector';
import { AppointmentConflictFeedback } from '../components/AppointmentConflictFeedback';
import { useAppointmentConflictRecovery } from '../hooks/useAppointmentConflictRecovery';
import { useAppointmentLifecycle } from '../hooks/useAppointmentLifecycle';
import { useAppointmentDuration } from '../hooks/useAppointmentDuration';
import { useWorkingMembers } from '../hooks/useWorkingMembers';
import { useCreateAppointment } from '../hooks/useCreateAppointment';
import { safeAppointmentHookError } from '../hooks/appointmentQuery';
import {
  appointmentFormSchema,
  type AppointmentFormValues,
} from '../schemas/appointmentForm.schema';
import type { CreateAppointmentInput } from '../schemas/appointment.schema';
import { resolveAppointmentDuration } from '../utils/appointmentDuration';

export function CreateAppointmentScreen() {
  const business = useBusiness();
  const lifetime = useAppointmentLifecycle('create-appointment-screen');
  const timezone = business.status === 'success' ? business.data.business.timezone : null;
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Nueva cita
        </Text>
        {business.status === 'pending' ? (
          <LoadingState message="Cargando negocio…" />
        ) : business.status === 'error' ? (
          <ErrorState message="No se pudo cargar el negocio." />
        ) : !lifetime.scope ? (
          <EmptyState title="Creación de citas no disponible" />
        ) : !timezone || !businessProfileSchema.shape.timezone.safeParse(timezone).success ? (
          <ErrorState message="La zona horaria del negocio no está disponible." />
        ) : (
          <CreateAppointmentForm
            key={JSON.stringify([lifetime.scope, timezone])}
            timezone={timezone}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function CreateAppointmentForm({ timezone }: { timezone: string }) {
  const [requestId] = useState(() => uuid.v4());
  const { control, handleSubmit, setValue, formState } = useForm<
    AppointmentFormValues,
    unknown,
    CreateAppointmentInput
  >({
    resolver: zodResolver(appointmentFormSchema),
    defaultValues: { requestId, clientId: '', barberMemberId: '', items: [], date: '', slot: null },
  });
  const values = useWatch({ control });
  const items = useWatch({ control, name: 'items' });
  const lifetime = useAppointmentLifecycle(JSON.stringify(['create-form', timezone, values]));
  const mutation = useCreateAppointment();
  const client = useClientDetail(values.clientId || null);
  const directory = useWorkingMembers();
  const estimate = useAppointmentDuration(items);
  const duration =
    estimate.status === 'success'
      ? resolveAppointmentDuration(
          estimate.baseDurationMinutes,
          estimate.scope!.role,
          values.durationOverride,
        )
      : null;
  const outcome = useAppointmentLifecycle(JSON.stringify(['create-outcome', timezone]));
  const conflict = useAppointmentConflictRecovery(
    duration !== null && values.barberMemberId && values.date
      ? { date: values.date, barberMemberId: values.barberMemberId, durationMinutes: duration }
      : null,
    timezone,
    JSON.stringify([values.date, values.barberMemberId, items, values.durationOverride]),
  );
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const confirmed = useRef(false);
  const pending = useRef(false);
  const captured = useRef<CreateAppointmentInput | null>(null);
  const validClient =
    client.status === 'success' &&
    !client.isFetching &&
    client.data.id === values.clientId &&
    client.data.business_id === lifetime.scope?.businessId &&
    client.data.is_active;
  const validMember =
    directory.status === 'success' &&
    !directory.isFetching &&
    directory.data.some(
      (m) => m.id === values.barberMemberId && m.is_active && ['OWNER', 'BARBER'].includes(m.role),
    ) &&
    (lifetime.scope?.role === 'OWNER' || values.barberMemberId === lifetime.scope?.membershipId);
  const eligible =
    validClient &&
    validMember &&
    duration !== null &&
    appointmentFormSchema.safeParse(values).success;
  function edit(change: () => void, clearSlot = false) {
    if (pending.current || confirmed.current || uncertain || !lifetime.isCurrent()) return;
    if (captured.current) {
      captured.current = null;
      mutation.reset();
      setValue('requestId', uuid.v4());
    }
    change();
    if (clearSlot) setValue('slot', null);
    setError(null);
  }
  async function send(input: CreateAppointmentInput, retry = false) {
    if (!lifetime.isCurrent()) return;
    try {
      const saved = retry ? await mutation.retry() : await mutation.mutateAsync(input);
      if (outcome.isCurrent()) {
        confirmed.current = true;
        setCompleted(true);
        router.replace({ pathname: '/appointments/[id]', params: { id: saved.id } });
      }
    } catch (reason) {
      if (outcome.isCurrent()) {
        const safe = safeAppointmentHookError(reason);
        setError(safe.code === 'APPOINTMENT_CONFLICT' ? null : safe.message);
        setUncertain(safe.code === 'NETWORK_ERROR' || safe.code === 'UNKNOWN_ERROR');
        if (safe.code === 'APPOINTMENT_CONFLICT') {
          setValue('slot', null);
          await conflict.recover();
        }
      }
    }
  }
  function submitOnce() {
    if (pending.current || confirmed.current || uncertain || !eligible || !lifetime.isCurrent())
      return;
    pending.current = true;
    setBusy(true);
    setError(null);
    void handleSubmit(async (input) => {
      if (!eligible || !lifetime.isCurrent()) return;
      captured.current = input;
      await send(input);
    })().finally(() => {
      pending.current = false;
      if (outcome.isCurrent()) setBusy(false);
    });
  }
  if (completed)
    return (
      <Text role="status" style={styles.text}>
        Cita creada. Abriendo detalle…
      </Text>
    );
  return (
    <View style={styles.section}>
      <Text style={styles.text}>
        Selecciona cliente, profesional, servicios, fecha y un horario disponible. Consultar
        horarios no reserva la cita.
      </Text>
      {!busy && !uncertain && (
        <>
          <Controller
            control={control}
            name="clientId"
            render={({ field }) => (
              <AppointmentClientSelector
                value={field.value || null}
                onChange={(id) => edit(() => field.onChange(id ?? ''))}
              />
            )}
          />
          <Controller
            control={control}
            name="barberMemberId"
            render={({ field }) => (
              <AppointmentProfessionalField
                value={field.value || null}
                onChange={(id) => edit(() => field.onChange(id), true)}
              />
            )}
          />
          <Controller
            control={control}
            name="items"
            render={({ field }) => (
              <AppointmentServiceSelector
                items={field.value}
                onChange={(items) => edit(() => field.onChange(items), true)}
              />
            )}
          />
          <Controller
            control={control}
            name="durationOverride"
            render={({ field }) => (
              <AppointmentDuration
                items={items}
                value={field.value}
                onChange={(duration) => edit(() => field.onChange(duration), true)}
              />
            )}
          />
          <Controller
            control={control}
            name="date"
            render={({ field }) => (
              <AppointmentDateField
                value={field.value}
                onChange={(date) => edit(() => field.onChange(date), true)}
              />
            )}
          />
          <Controller
            control={control}
            name="slot"
            render={({ field }) => (
              <AppointmentSlotSelector
                date={values.date ?? ''}
                duration={duration}
                barberMemberId={values.barberMemberId || null}
                value={field.value}
                onChange={(slot) => {
                  // Automatic selection invalidation must not create a new request identity.
                  if (!pending.current && lifetime.isCurrent()) {
                    if (slot === null) field.onChange(null);
                    else {
                      edit(() => field.onChange(slot));
                      conflict.reset();
                    }
                  }
                }}
              />
            )}
          />
          <Controller
            control={control}
            name="notes"
            render={({ field }) => (
              <AppointmentNotesField
                value={field.value ?? null}
                onChange={(notes) => edit(() => field.onChange(notes))}
              />
            )}
          />
        </>
      )}
      {busy && <LoadingState message="Guardando cita…" />}
      {!busy && conflict.conflicted && (
        <AppointmentConflictFeedback
          refreshError={conflict.refreshError}
          onRetryReads={conflict.retryReads}
        />
      )}
      {Object.entries(formState.errors).map(([field, issue]) => (
        <Text key={field} role="alert" style={styles.text}>
          {issue.message}
        </Text>
      ))}
      {error && (
        <Text role="alert" style={styles.text}>
          {error}
        </Text>
      )}
      {uncertain ? (
        <>
          <Text style={styles.text}>
            El resultado aún no está confirmado. Reintentar conserva la misma solicitud y sus datos.
            Salir no confirma que la cita no se haya creado.
          </Text>
          <Button
            label="Reintentar misma solicitud"
            loading={busy}
            onPress={() => {
              if (pending.current || !captured.current || !lifetime.isCurrent()) return;
              pending.current = true;
              setBusy(true);
              void send(captured.current, true).finally(() => {
                pending.current = false;
                if (outcome.isCurrent()) setBusy(false);
              });
            }}
          />
        </>
      ) : (
        <Button label="Crear cita" loading={busy} disabled={!eligible} onPress={submitOnce} />
      )}
      <Button
        label="Cancelar sin guardar"
        variant="secondary"
        disabled={busy}
        onPress={() => {
          if (!pending.current && lifetime.isCurrent()) {
            if (router.canGoBack()) router.back();
            else router.replace('/agenda');
          }
        }}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing[16], gap: theme.spacing[16] },
  section: { gap: theme.spacing[12] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  text: { ...theme.typography.body, color: theme.colors.textPrimary },
});
