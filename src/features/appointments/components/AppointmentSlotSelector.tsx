import { useLayoutEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { businessProfileSchema } from '@/features/business/schemas/businessSettings.schema';
import { theme } from '@/theme';

import { useAvailability } from '../hooks/useAvailability';
import { usableAppointmentId, useAppointmentLifecycle } from '../hooks/useAppointmentLifecycle';
import { createAppointmentSchema } from '../schemas/appointment.schema';
import { appointmentCivilDateSchema } from '../schemas/appointmentDate.schema';
import { safeAppointmentHookError } from '../hooks/appointmentQuery';
import type { AppointmentAvailabilitySlot } from '../types/appointment.types';
import {
  appointmentSlotLabel,
  matchingAppointmentSlot,
  orderAppointmentSlots,
} from '../utils/appointmentSlots';

export type AppointmentSlotSelectorProps = {
  date: string;
  duration: number | null;
  barberMemberId: string | null;
  value: AppointmentAvailabilitySlot | null;
  onChange: (value: AppointmentAvailabilitySlot | null) => void;
  // Existing BF142/BF146 exclusion transport; the server validates visibility and tenant.
  excludeAppointmentId?: string;
};

export function AppointmentSlotSelector({
  date,
  duration,
  barberMemberId,
  value,
  onChange,
  excludeAppointmentId,
}: AppointmentSlotSelectorProps) {
  const business = useBusiness();
  const timezone = business.status === 'success' ? business.data.business.timezone : null;
  const validTimezone =
    timezone !== null && businessProfileSchema.shape.timezone.safeParse(timezone).success;
  const lifetime = useAppointmentLifecycle(
    JSON.stringify([date, duration, barberMemberId, timezone, excludeAppointmentId]),
  );
  const { scope } = lifetime;
  const validInput =
    appointmentCivilDateSchema.safeParse(date).success &&
    createAppointmentSchema.shape.durationOverride.unwrap().safeParse(duration).success &&
    usableAppointmentId(barberMemberId) &&
    (excludeAppointmentId === undefined || usableAppointmentId(excludeAppointmentId));
  const allowedMember =
    scope !== null && (scope.role === 'OWNER' || barberMemberId === scope.membershipId);
  const ready = validInput && validTimezone && allowedMember;
  const result = useAvailability(
    ready && barberMemberId !== null && duration !== null
      ? {
          date,
          barberMemberId,
          durationMinutes: duration,
          ...(excludeAppointmentId !== undefined ? { excludeAppointmentId } : {}),
        }
      : null,
    timezone,
  );
  const parameterKey = JSON.stringify([
    scope,
    timezone,
    date,
    duration,
    barberMemberId,
    excludeAppointmentId,
  ]);
  const previousKey = useRef(parameterKey);
  const rows = useMemo(() => {
    if (result.status !== 'success') return null;
    try {
      return orderAppointmentSlots(result.data);
    } catch {
      return null;
    }
  }, [result.status, result.data]);
  const selected =
    ready && result.status === 'success' && rows ? matchingAppointmentSlot(rows, value) : null;
  const interaction = useRef<{
    rows: AppointmentAvailabilitySlot[] | null;
    fetching: boolean;
    status: typeof result.status;
    onChange: AppointmentSlotSelectorProps['onChange'];
  } | null>(null);
  useLayoutEffect(() => {
    interaction.current = { rows, fetching: result.isFetching, status: result.status, onChange };
    return () => {
      interaction.current = null;
    };
  }, [rows, result.isFetching, result.status, onChange]);
  useLayoutEffect(() => {
    const changed = previousKey.current !== parameterKey;
    previousKey.current = parameterKey;
    // The parent owns the value. Clear a changed parameter/context set before paint.
    if (
      value !== null &&
      (changed ||
        !ready ||
        (result.status === 'success' &&
          !result.isFetching &&
          (!rows || !matchingAppointmentSlot(rows, value))))
    )
      onChange(null);
  }, [parameterKey, ready, result.status, result.isFetching, rows, value, onChange]);

  if (business.status === 'pending') return <LoadingState message="Cargando negocio…" />;
  if (business.status === 'error')
    return <ErrorState message="No se pudo cargar el negocio para consultar horarios." />;
  if (scope === null) return <EmptyState title="Horarios no disponibles" />;
  if (!validTimezone)
    return <ErrorState message="La zona horaria del negocio no está disponible." />;
  if (!validInput)
    return <EmptyState title="Selecciona fecha, profesional y duración para consultar horarios" />;
  if (!allowedMember) return <ErrorState message="No se pudo acceder a esta agenda." />;
  if (result.status === 'pending' || result.isFetching)
    return <LoadingState message="Consultando horarios…" />;
  if (result.status === 'error' || (result.status === 'success' && rows === null))
    return (
      <ErrorState
        message={
          result.status === 'error'
            ? safeAppointmentHookError(result.error).message
            : 'No se pudieron leer los horarios disponibles.'
        }
        onRetry={() => {
          if (lifetime.isCurrent()) void result.refetch();
        }}
      />
    );
  if (result.status !== 'success' || rows === null)
    return <EmptyState title="Horarios no disponibles" />;
  return (
    <View style={styles.section}>
      <Text role="heading" style={styles.heading}>
        Horarios disponibles
      </Text>
      <Text style={styles.hint}>Zona horaria del negocio: {timezone}</Text>
      <Text role="status" aria-live="polite" style={styles.text}>
        {selected
          ? `Horario seleccionado: ${appointmentSlotLabel(selected, timezone!)}`
          : 'Sin horario seleccionado'}
      </Text>
      {!rows.some((row) => row.available) && (
        <EmptyState title="No hay horarios disponibles para esta fecha y duración" />
      )}
      <View role="group" accessibilityLabel="Seleccionar horario del turno" style={styles.controls}>
        {rows.map((slot) => {
          const isSelected =
            selected?.start_at === slot.start_at && selected?.end_at === slot.end_at;
          const label = `${appointmentSlotLabel(slot, timezone!)} · ${slot.available ? 'Disponible' : 'No disponible'}`;
          return (
            <Button
              key={JSON.stringify([slot.start_at, slot.end_at])}
              label={label}
              accessibilityLabel={`Horario: ${label}`}
              variant={isSelected ? 'primary' : 'outline'}
              disabled={!slot.available}
              accessibilityState={Platform.OS === 'web' ? undefined : { selected: isSelected }}
              {...(Platform.OS === 'web' ? { 'aria-pressed': isSelected } : {})}
              style={styles.slot}
              onPress={() => {
                const current = interaction.current;
                if (
                  lifetime.isCurrent() &&
                  current?.status === 'success' &&
                  !current.fetching &&
                  current.rows === rows &&
                  rows.includes(slot) &&
                  slot.available
                )
                  current.onChange(slot);
              }}
            />
          );
        })}
      </View>
      <Text style={styles.hint}>Consultar o seleccionar un horario no reserva el turno.</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: theme.spacing[12], minWidth: 0 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[8] },
  slot: { flexShrink: 1 },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  text: { ...theme.typography.body, color: theme.colors.textPrimary },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary },
});
