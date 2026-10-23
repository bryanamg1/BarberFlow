import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { businessProfileSchema } from '@/features/business/schemas/businessSettings.schema';
import { theme } from '@/theme';

import { useAppointmentLifecycle } from '../hooks/useAppointmentLifecycle';
import type { AppointmentRow, AppointmentStatus } from '../types/appointment.types';
import {
  agendaAppointmentRange,
  agendaDateLabel,
  businessCivilDate,
  type AgendaSegment,
} from '../utils/agendaCalendar';

export type AgendaViewProps = {
  appointments: readonly AppointmentRow[];
  selectedDate?: string | null;
  onSelectDate: (date: string) => void;
  onSelectAppointment: (id: string) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};
const statuses: Record<AppointmentStatus, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No asistió',
};
export function useAgendaPresentation(resource: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const business = useBusiness();
  const timezone = business.status === 'success' ? business.data.business.timezone : null;
  const lifetime = useAppointmentLifecycle(JSON.stringify([resource, timezone]));
  const validTimezone =
    timezone !== null && businessProfileSchema.shape.timezone.safeParse(timezone).success;
  const today = useMemo(
    () => (validTimezone && timezone ? businessCivilDate(now, timezone) : null),
    [now, timezone, validTimezone],
  );
  return { ...lifetime, timezone: validTimezone ? timezone : null, business, today };
}
export function AgendaContextFeedback({
  context,
}: {
  context: ReturnType<typeof useAgendaPresentation>;
}) {
  if (context.business.status === 'pending') return <LoadingState message="Cargando negocio…" />;
  if (context.business.status === 'error')
    return <ErrorState message="No se pudo cargar el negocio para mostrar la agenda." />;
  if (context.business.status === 'success' && context.timezone === null)
    return <ErrorState message="La zona horaria del negocio no está disponible." />;
  return <EmptyState title="Agenda no disponible" />;
}
export function AgendaDayHeading({
  date,
  count,
  today,
  selected,
  compact = false,
  onPress,
}: {
  date: string;
  count: number;
  today: boolean;
  selected: boolean;
  compact?: boolean;
  onPress: () => void;
}) {
  return (
    <View style={agendaStyles.dayHeading}>
      <Button
        label={compact ? String(Number(date.slice(-2))) : agendaDateLabel(date)}
        accessibilityLabel={`${agendaDateLabel(date)}${today ? ', Hoy' : ''}, ${count} turnos visibles`}
        accessibilityState={{ selected }}
        variant={selected ? 'primary' : 'secondary'}
        onPress={onPress}
        style={agendaStyles.dayButton}
        textStyle={compact ? theme.typography.caption : theme.typography.body}
      />
      {today && <Text style={agendaStyles.hint}>Hoy</Text>}
      <Text style={agendaStyles.hint}>{count} turnos visibles</Text>
    </View>
  );
}
// Compact representation only. Appointment cards/actions are owned by later tickets.
export function AgendaAppointmentEntry({
  segment,
  timezone,
  onPress,
}: {
  segment: AgendaSegment;
  timezone: string;
  onPress: () => void;
}) {
  const { appointment, continued } = segment;
  const range = agendaAppointmentRange(appointment, timezone);
  const label = `${continued ? 'Continúa · ' : ''}${range} · ${statuses[appointment.status]}`;
  return (
    <Button
      label={label}
      accessibilityLabel={`Turno, ${label}`}
      variant="ghost"
      onPress={onPress}
      style={agendaStyles.entry}
      textStyle={[
        theme.typography.caption,
        { color: theme.semanticColors.appointmentStatus[appointment.status] },
      ]}
    />
  );
}
export const agendaStyles = StyleSheet.create({
  section: { gap: theme.spacing[12] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  cell: {
    flex: 1,
    minWidth: theme.sizing.touchTarget + 2 * theme.spacing[4],
    padding: theme.spacing[4],
    borderWidth: theme.borderWidths.thin,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  dayHeading: { gap: theme.spacing[4] },
  dayButton: { paddingHorizontal: theme.spacing[4], flexShrink: 1 },
  entry: { paddingHorizontal: theme.spacing[4], justifyContent: 'flex-start' },
});
