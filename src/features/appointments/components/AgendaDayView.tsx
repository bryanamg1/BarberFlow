import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState } from '@/components/ui';

import {
  AgendaAppointmentEntry,
  AgendaContextFeedback,
  agendaStyles,
  useAgendaPresentation,
  type AgendaViewProps,
} from './AgendaPresentation';
import {
  agendaDateLabel,
  agendaPeriod,
  groupAgenda,
  shiftCivilDate,
} from '../utils/agendaCalendar';

export type AgendaDayViewProps = Omit<AgendaViewProps, 'selectedDate' | 'onSelectDate'> & {
  civilDate: string;
};

export function AgendaDayView({
  civilDate,
  appointments,
  onSelectAppointment,
  loading = false,
  error = null,
  onRetry,
}: AgendaDayViewProps) {
  const context = useAgendaPresentation(civilDate);
  const { timezone, scope } = context;
  const businessId = scope?.businessId ?? null;
  const period = useMemo(() => {
    try {
      return timezone ? agendaPeriod(civilDate, shiftCivilDate(civilDate, 1), timezone) : null;
    } catch {
      return null;
    }
  }, [civilDate, timezone]);
  const segments = useMemo(
    () => (period && businessId ? groupAgenda(period, appointments, businessId)[0] : []),
    [period, appointments, businessId],
  );
  if (!scope || !timezone) return <AgendaContextFeedback context={context} />;
  if (!period) return <ErrorState message="El día de la agenda no es válido." />;
  if (loading) return <LoadingState message="Cargando turnos del día…" />;
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
        {agendaDateLabel(civilDate)}
      </Text>
      {context.today === civilDate && <Text style={agendaStyles.hint}>Hoy</Text>}
      <Text style={agendaStyles.hint}>Zona horaria: {timezone}</Text>
      <Text style={agendaStyles.hint}>{segments.length} turnos visibles</Text>
      {segments.length === 0 ? (
        <EmptyState title="No hay turnos visibles en este día" />
      ) : (
        segments.map((segment) => (
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
  );
}
