import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, EmptyState, ErrorState, Input, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { businessProfileSchema } from '@/features/business/schemas/businessSettings.schema';
import { theme } from '@/theme';
import { AppointmentDateField } from '../components/AppointmentDateField';
import { AppointmentNotesField } from '../components/AppointmentNotesField';
import { AppointmentProfessionalField } from '../components/AppointmentProfessionalField';
import { AppointmentSlotSelector } from '../components/AppointmentSlotSelector';
import { AppointmentConflictFeedback } from '../components/AppointmentConflictFeedback';
import { useAppointmentConflictRecovery } from '../hooks/useAppointmentConflictRecovery';
import { useAppointmentDetail } from '../hooks/useAppointmentDetail';
import { useAppointmentLifecycle, usableAppointmentId } from '../hooks/useAppointmentLifecycle';
import { useRescheduleAppointment } from '../hooks/useRescheduleAppointment';
import { useUpdateAppointmentNotes } from '../hooks/useUpdateAppointmentNotes';
import { safeAppointmentHookError } from '../hooks/appointmentQuery';
import {
  rescheduleAppointmentSchema,
  updateAppointmentNotesSchema,
  type UpdateAppointmentNotesInput,
} from '../schemas/appointment.schema';
import type { AppointmentAvailabilitySlot, AppointmentDetail } from '../types/appointment.types';
import { businessCivilDate } from '../utils/agendaCalendar';
import { canManageAppointment, persistedAppointmentMinutes } from '../utils/appointmentEditing';

export function AppointmentEditScreen({ appointmentId }: { appointmentId: string | null }) {
  const business = useBusiness();
  const lifetime = useAppointmentLifecycle(JSON.stringify(['edit-screen', appointmentId]));
  const timezone = business.status === 'success' ? business.data.business.timezone : null;
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Editar cita
        </Text>
        {business.status === 'pending' ? (
          <LoadingState message="Cargando negocio…" />
        ) : business.status === 'error' ? (
          <ErrorState message="No se pudo cargar el negocio." />
        ) : !lifetime.scope || !timezone || !usableAppointmentId(appointmentId) ? (
          <EmptyState title="Cita no disponible" />
        ) : !businessProfileSchema.shape.timezone.safeParse(timezone).success ? (
          <ErrorState message="La zona horaria del negocio no está disponible." />
        ) : (
          <Editor
            key={JSON.stringify([lifetime.scope, appointmentId, timezone])}
            appointmentId={appointmentId}
            timezone={timezone}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
function Editor({ appointmentId, timezone }: { appointmentId: string; timezone: string }) {
  const result = useAppointmentDetail(appointmentId);
  const lifetime = useAppointmentLifecycle(JSON.stringify(['editor', appointmentId, timezone]));
  // Keep write lifetimes above read feedback: a failed detail refresh must not
  // unmount a confirmed mutation and reclassify its outcome as a write failure.
  const notesMutation = useUpdateAppointmentNotes();
  const rescheduleMutation = useRescheduleAppointment();
  const saved = () => {
    if (lifetime.isCurrent())
      router.replace({ pathname: '/appointments/[id]', params: { id: appointmentId } });
  };
  const [mode, setMode] = useState<'notes' | 'reschedule'>('notes');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  function markBusy(value: boolean) {
    pending.current = value;
    setBusy(value);
  }
  if (result.status === 'pending') return <LoadingState message="Cargando cita…" />;
  if (result.status === 'error')
    return (
      <ErrorState
        message={safeAppointmentHookError(result.error).message}
        onRetry={() => {
          if (lifetime.isCurrent()) void result.refetch();
        }}
      />
    );
  if (
    result.status !== 'success' ||
    result.data.id !== appointmentId ||
    !canManageAppointment(result.data, lifetime.scope)
  )
    return <EmptyState title="Esta cita no permite edición" />;
  return (
    <View style={styles.section}>
      <Text style={styles.text}>
        Los servicios y precios históricos se conservan. Notas y reprogramación se guardan por
        separado.
      </Text>
      <Button
        label={mode === 'notes' ? 'Reprogramar cita' : 'Editar solo notas'}
        variant="secondary"
        disabled={busy}
        onPress={() => {
          if (!pending.current && lifetime.isCurrent())
            setMode(mode === 'notes' ? 'reschedule' : 'notes');
        }}
      />
      {mode === 'notes' ? (
        <NotesEditor
          key={appointmentId}
          appointment={result.data}
          onBusy={markBusy}
          mutation={notesMutation}
          onSaved={saved}
        />
      ) : (
        <RescheduleEditor
          key={appointmentId}
          appointment={result.data}
          timezone={timezone}
          onBusy={markBusy}
          mutation={rescheduleMutation}
          onSaved={saved}
        />
      )}
      <Button
        label="Volver sin guardar"
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
function NotesEditor({
  appointment,
  onBusy,
  mutation,
  onSaved,
}: {
  appointment: AppointmentDetail;
  onBusy: (busy: boolean) => void;
  mutation: ReturnType<typeof useUpdateAppointmentNotes>;
  onSaved: () => void;
}) {
  const { control, handleSubmit, formState } = useForm<UpdateAppointmentNotesInput>({
    resolver: zodResolver(updateAppointmentNotesSchema),
    defaultValues: { appointmentId: appointment.id, notes: appointment.notes },
  });
  const lifetime = useAppointmentLifecycle(JSON.stringify(['notes-editor', appointment.id]));
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = handleSubmit(async (input) => {
    if (!lifetime.isCurrent() || !canManageAppointment(appointment, lifetime.scope)) return;
    try {
      await mutation.mutateAsync(input);
      onSaved();
    } catch (reason) {
      if (lifetime.isCurrent()) setError(safeAppointmentHookError(reason).message);
    }
  });
  return (
    <View style={styles.section}>
      {!busy && (
        <Controller
          control={control}
          name="notes"
          render={({ field }) => (
            <AppointmentNotesField
              value={field.value}
              onChange={(text) => {
                if (lifetime.isCurrent()) {
                  mutation.reset();
                  field.onChange(text);
                }
              }}
            />
          )}
        />
      )}
      {formState.errors.notes && (
        <Text role="alert" style={styles.text}>
          {formState.errors.notes.message}
        </Text>
      )}
      {error && (
        <Text role="alert" style={styles.text}>
          {error}
        </Text>
      )}
      <Button
        label="Guardar notas"
        loading={busy}
        onPress={() => {
          if (inFlight.current || !lifetime.isCurrent()) return;
          inFlight.current = true;
          setBusy(true);
          onBusy(true);
          setError(null);
          void submit().finally(() => {
            inFlight.current = false;
            if (lifetime.isCurrent()) {
              setBusy(false);
              onBusy(false);
            }
          });
        }}
      />
    </View>
  );
}
function RescheduleEditor({
  appointment,
  timezone,
  onBusy,
  mutation,
  onSaved,
}: {
  appointment: AppointmentDetail;
  timezone: string;
  onBusy: (busy: boolean) => void;
  mutation: ReturnType<typeof useRescheduleAppointment>;
  onSaved: () => void;
}) {
  const { control, handleSubmit, setValue } = useForm({
    resolver: zodResolver(rescheduleAppointmentSchema),
    defaultValues: {
      appointmentId: appointment.id,
      barberMemberId: appointment.barber_member_id,
      startAt: '',
      durationOverride: undefined as number | undefined,
    },
  });
  const values = useWatch({ control });
  const [date, setDate] = useState(() =>
    businessCivilDate(Date.parse(appointment.start_at), timezone),
  );
  const [slot, setSlot] = useState<AppointmentAvailabilitySlot | null>(null);
  const [overrideText, setOverrideText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const lifetime = useAppointmentLifecycle(
    JSON.stringify(['reschedule-editor', appointment.id, timezone]),
  );
  const duration = values.durationOverride ?? persistedAppointmentMinutes(appointment);
  const conflict = useAppointmentConflictRecovery(
    duration !== null && values.barberMemberId
      ? {
          date,
          durationMinutes: duration,
          barberMemberId: values.barberMemberId,
          excludeAppointmentId: appointment.id,
        }
      : null,
    timezone,
    JSON.stringify([appointment.id, date, values.barberMemberId, values.durationOverride]),
  );
  function clear() {
    setSlot(null);
    setValue('startAt', '');
    mutation.reset();
  }
  const submit = handleSubmit(async (input) => {
    if (
      !slot ||
      input.startAt !== slot.start_at ||
      !lifetime.isCurrent() ||
      !canManageAppointment(appointment, lifetime.scope)
    )
      return;
    try {
      await mutation.mutateAsync(input);
      onSaved();
    } catch (reason) {
      if (lifetime.isCurrent()) {
        const safe = safeAppointmentHookError(reason);
        setError(safe.code === 'APPOINTMENT_CONFLICT' ? null : safe.message);
        if (safe.code === 'APPOINTMENT_CONFLICT') {
          setSlot(null);
          setValue('startAt', '');
          await conflict.recover();
        }
      }
    }
  });
  return (
    <View style={styles.section}>
      {!busy && (
        <>
          <AppointmentProfessionalField
            value={values.barberMemberId ?? null}
            onChange={(id) => {
              if (lifetime.isCurrent()) {
                clear();
                setValue('barberMemberId', id);
              }
            }}
          />
          <AppointmentDateField
            value={date}
            onChange={(text) => {
              if (lifetime.isCurrent()) {
                clear();
                setDate(text);
              }
            }}
          />
          <Text style={styles.text}>
            Duración persistida: {persistedAppointmentMinutes(appointment) ?? 'No disponible'}{' '}
            minutos
          </Text>
          {lifetime.scope?.role === 'OWNER' && (
            <Input
              label="Nueva duración opcional (minutos)"
              keyboardType="number-pad"
              value={overrideText}
              onChangeText={(text) => {
                if (lifetime.isCurrent()) {
                  clear();
                  setOverrideText(text);
                  setValue(
                    'durationOverride',
                    text === '' ? undefined : /^\d+$/.test(text) ? Number(text) : NaN,
                  );
                }
              }}
            />
          )}
          <AppointmentSlotSelector
            date={date}
            duration={duration}
            barberMemberId={values.barberMemberId ?? null}
            value={slot}
            excludeAppointmentId={appointment.id}
            onChange={(next) => {
              if (lifetime.isCurrent()) {
                mutation.reset();
                setSlot(next);
                setValue('startAt', next?.start_at ?? '');
                if (next !== null) conflict.reset();
              }
            }}
          />
        </>
      )}
      {error && (
        <Text role="alert" style={styles.text}>
          {error}
        </Text>
      )}
      {!busy && conflict.conflicted && (
        <AppointmentConflictFeedback
          refreshError={conflict.refreshError}
          onRetryReads={conflict.retryReads}
        />
      )}
      <Button
        label="Guardar reprogramación"
        disabled={!slot}
        loading={busy}
        onPress={() => {
          if (inFlight.current || !lifetime.isCurrent() || !slot) return;
          inFlight.current = true;
          setBusy(true);
          onBusy(true);
          setError(null);
          void submit().finally(() => {
            inFlight.current = false;
            if (lifetime.isCurrent()) {
              setBusy(false);
              onBusy(false);
            }
          });
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
