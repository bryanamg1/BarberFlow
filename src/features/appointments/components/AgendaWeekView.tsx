import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState } from '@/components/ui';

import {
  AgendaAppointmentEntry,
  AgendaContextFeedback,
  AgendaDayHeading,
  agendaStyles,
  useAgendaPresentation,
  type AgendaViewProps,
} from './AgendaPresentation';
import { agendaDateLabel, agendaWeek, groupAgenda } from '../utils/agendaCalendar';

export type AgendaWeekViewProps = AgendaViewProps & { civilWeekStart: string };

export function AgendaWeekView({
  civilWeekStart,
  appointments,
  selectedDate = null,
  onSelectDate,
  onSelectAppointment,
  loading = false,
  error = null,
  onRetry,
}: AgendaWeekViewProps) {
  const context = useAgendaPresentation(civilWeekStart),
    { timezone, scope } = context;
  const businessId = scope?.businessId ?? null;
  const period = useMemo(() => {
    try {
      return timezone ? agendaWeek(civilWeekStart, timezone) : null;
    } catch {
      return null;
    }
  }, [civilWeekStart, timezone]);
  const groups = useMemo(
    () => (period && businessId ? groupAgenda(period, appointments, businessId) : []),
    [period, appointments, businessId],
  );
  if (!scope || !timezone) return <AgendaContextFeedback context={context} />;
  if (!period)
    return <ErrorState message="La semana de la agenda debe comenzar un lunes válido." />;
  if (loading) return <LoadingState message="Cargando turnos de la semana…" />;
  if (error)
    return (
      <ErrorState
        message={error}
        onRetry={
          onRetry
            ? () => {
                if (context.isCurrent()) onRetry();
              }
            : undefined
        }
      />
    );
  return (
    <View style={agendaStyles.section}>
      <Text role="heading" style={agendaStyles.heading}>
        Semana del {agendaDateLabel(civilWeekStart)}
      </Text>
      <Text style={agendaStyles.hint}>Zona horaria: {timezone}</Text>
      {groups.every((group) => group.length === 0) && (
        <EmptyState title="No hay turnos visibles en esta semana" />
      )}
      {period.days.map((day, index) => (
        <View key={day.date} style={agendaStyles.cell}>
          <AgendaDayHeading
            date={day.date}
            count={groups[index].length}
            today={context.today === day.date}
            selected={selectedDate === day.date}
            onPress={() => {
              if (context.isCurrent()) onSelectDate(day.date);
            }}
          />
          {groups[index].length === 0 ? (
            <Text style={agendaStyles.hint}>Sin turnos visibles este día</Text>
          ) : (
            groups[index].map((segment) => (
              <AgendaAppointmentEntry
                key={segment.appointment.id}
                segment={segment}
                timezone={timezone}
                onPress={() => {
                  if (context.isCurrent()) onSelectAppointment(segment.appointment.id);
                }}
              />
            ))
          )}
        </View>
      ))}
    </View>
  );
}
