import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { theme } from '@/theme';

import {
  AgendaAppointmentEntry,
  AgendaContextFeedback,
  AgendaDayHeading,
  agendaStyles,
  useAgendaPresentation,
  type AgendaViewProps,
} from './AgendaPresentation';
import { agendaMonth, agendaMonthLabel, groupAgenda } from '../utils/agendaCalendar';

export type AgendaMonthViewProps = AgendaViewProps & { civilMonth: string };

export function AgendaMonthView({
  civilMonth,
  appointments,
  selectedDate = null,
  onSelectDate,
  onSelectAppointment,
  loading = false,
  error = null,
  onRetry,
}: AgendaMonthViewProps) {
  const context = useAgendaPresentation(civilMonth);
  const { timezone, scope } = context;
  const businessId = scope?.businessId ?? null;
  const period = useMemo(() => {
    try {
      return timezone ? agendaMonth(civilMonth, timezone) : null;
    } catch {
      return null;
    }
  }, [civilMonth, timezone]);
  const groups = useMemo(
    () => (period && businessId ? groupAgenda(period, appointments, businessId) : []),
    [period, appointments, businessId],
  );
  if (!scope || !timezone) return <AgendaContextFeedback context={context} />;
  if (!period) return <ErrorState message="El mes de la agenda no es válido." />;
  if (loading) return <LoadingState message="Cargando turnos del mes…" />;
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
  const today = context.today;
  const cellCount = Math.ceil((period.leading + period.days.length) / 7) * 7;
  return (
    <View style={agendaStyles.section}>
      <Text role="heading" style={agendaStyles.heading}>
        {agendaMonthLabel(civilMonth)}
      </Text>
      <Text style={agendaStyles.hint}>Zona horaria: {timezone}</Text>
      {groups.every((group) => group.length === 0) && (
        <EmptyState title="No hay turnos visibles en este mes" />
      )}
      <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
        <View
          style={{ flexGrow: 1, minWidth: 7 * (theme.sizing.touchTarget + 2 * theme.spacing[4]) }}
        >
          <View style={agendaStyles.row}>
            {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((label) => (
              <Text key={label} style={[agendaStyles.cell, agendaStyles.hint]}>
                {label}
              </Text>
            ))}
          </View>
          {Array.from({ length: cellCount / 7 }, (_, week) => (
            <View key={week} style={agendaStyles.row}>
              {Array.from({ length: 7 }, (_, weekday) => {
                const index = week * 7 + weekday - period.leading,
                  day = period.days[index];
                if (!day)
                  return <View key={weekday} style={agendaStyles.cell} accessible={false} />;
                return (
                  <View key={day.date} style={agendaStyles.cell}>
                    <AgendaDayHeading
                      date={day.date}
                      count={groups[index].length}
                      compact
                      today={today === day.date}
                      selected={selectedDate === day.date}
                      onPress={() => {
                        if (context.isCurrent()) onSelectDate(day.date);
                      }}
                    />
                    {groups[index].map((segment) => (
                      <AgendaAppointmentEntry
                        key={segment.appointment.id}
                        segment={segment}
                        timezone={timezone}
                        onPress={() => {
                          if (context.isCurrent()) onSelectAppointment(segment.appointment.id);
                        }}
                      />
                    ))}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
