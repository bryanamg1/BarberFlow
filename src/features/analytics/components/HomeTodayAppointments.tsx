import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { AppointmentCard } from '@/features/appointments/components/AppointmentCard';
import {
  AgendaContextFeedback,
  agendaStyles,
  useAgendaPresentation,
} from '@/features/appointments/components/AgendaPresentation';
import { useAppointmentLifecycle } from '@/features/appointments/hooks/useAppointmentLifecycle';
import { useAppointments } from '@/features/appointments/hooks/useAppointments';
import {
  agendaDateLabel,
  agendaPeriod,
  shiftCivilDate,
} from '@/features/appointments/utils/agendaCalendar';

import { homeTodaySegments } from '../utils/homeTodayAppointments';

export function HomeTodayAppointments() {
  const context = useAgendaPresentation('home-today');
  const { today, timezone, scope } = context;
  const validContext =
    scope !== null && context.business.status === 'success' && !context.business.isFetching;
  const period = useMemo(() => {
    try {
      return today && timezone ? agendaPeriod(today, shiftCivilDate(today, 1), timezone) : null;
    } catch {
      return null;
    }
  }, [today, timezone]);
  const selection = useAppointmentLifecycle(JSON.stringify(['home-today', period?.range]));
  const result = useAppointments(validContext ? (period?.range ?? null) : null);
  const router = useRouter();

  if (!validContext || !timezone) return <AgendaContextFeedback context={context} />;
  if (!period || !today) return <ErrorState message="El día de la agenda no es válido." />;
  if (result.status === 'idle') return <EmptyState title="Agenda no disponible" />;
  if (result.status === 'pending') return <LoadingState message="Cargando turnos del día…" />;
  if (result.status === 'error')
    return <ErrorState message={result.error.message} onRetry={() => void result.refetch()} />;
  if (!Array.isArray(result.data)) return <EmptyState title="Agenda no disponible" />;
  const segments = homeTodaySegments(period, result.data, scope);
  return (
    <View style={agendaStyles.section}>
      <Text role="heading" style={agendaStyles.heading}>
        {agendaDateLabel(today)}
      </Text>
      <Text style={agendaStyles.hint}>Hoy</Text>
      {segments.length === 0 ? (
        <EmptyState title="No hay turnos visibles en este día" />
      ) : (
        segments.map((segment) => (
          <AppointmentCard
            key={segment.appointment.id}
            appointment={segment.appointment}
            segment={segment}
            timezone={timezone}
            onPress={() => {
              if (selection.isCurrent())
                router.push({
                  pathname: '/appointments/[id]',
                  params: { id: segment.appointment.id },
                });
            }}
          />
        ))
      )}
    </View>
  );
}
