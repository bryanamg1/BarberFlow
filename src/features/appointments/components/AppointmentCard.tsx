import { StyleSheet, Text } from 'react-native';

import { Button, Card } from '@/components/ui';
import { theme } from '@/theme';

import type { AppointmentRow, AppointmentStatus } from '../types/appointment.types';
import { agendaAppointmentRange, type AgendaSegment } from '../utils/agendaCalendar';

const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No asistió',
};

export type AppointmentCardProps = {
  appointment: AppointmentRow;
  timezone: string;
  onPress?: () => void;
  segment?: Pick<AgendaSegment, 'continued'>;
  clientLabel?: string | null;
  barberLabel?: string | null;
  serviceSummary?: string | null;
  variant?: 'default' | 'compact';
};

// Display strings must come from already authorized data, never inferred from reference IDs.
export function AppointmentCard({
  appointment,
  timezone,
  onPress,
  segment,
  clientLabel,
  barberLabel,
  serviceSummary,
  variant = 'default',
}: AppointmentCardProps) {
  const range = agendaAppointmentRange(appointment, timezone);
  const summary = `${segment?.continued ? 'Continúa · ' : ''}${range} · ${appointmentStatusLabels[appointment.status]}`;
  const details = [clientLabel, barberLabel, serviceSummary].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  const label = [summary, ...details].join('\n');
  const accessibilityLabel = `Turno, ${[summary, ...details].join(', ')}`;
  const compact = variant === 'compact';
  const textStyle = [
    compact ? theme.typography.caption : theme.typography.body,
    styles.text,
    { color: theme.semanticColors.appointmentStatus[appointment.status] },
  ];
  if (onPress)
    return (
      <Button
        label={label}
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        variant={compact ? 'ghost' : 'secondary'}
        style={compact ? styles.compact : styles.card}
        textStyle={textStyle}
      />
    );
  return (
    <Card
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      style={compact ? styles.compact : undefined}
    >
      <Text
        accessible={false}
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        style={textStyle}
      >
        {label}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: theme.radius.card, justifyContent: 'flex-start', ...theme.shadows.raised },
  compact: { paddingHorizontal: theme.spacing[4], justifyContent: 'flex-start' },
  text: { textAlign: 'left' },
});
