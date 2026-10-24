import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState } from '@/components/ui';
import { theme } from '@/theme';

import { AgendaDayView } from '../components/AgendaDayView';
import { AgendaMonthView } from '../components/AgendaMonthView';
import { AgendaContextFeedback, useAgendaPresentation } from '../components/AgendaPresentation';
import { AgendaViewTabs, type AgendaView } from '../components/AgendaViewTabs';
import { AgendaWeekView } from '../components/AgendaWeekView';
import { useAppointmentLifecycle } from '../hooks/useAppointmentLifecycle';
import { useAppointments } from '../hooks/useAppointments';
import { agendaViewPeriod } from '../utils/agendaViewPeriod';

export function AgendaScreen() {
  const context = useAgendaPresentation('agenda-screen');
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Agenda
        </Text>
        {context.scope && context.timezone && context.today ? (
          <ScopedAgenda
            key={JSON.stringify([context.scope, context.timezone])}
            initialDate={context.today}
            timezone={context.timezone}
          />
        ) : (
          <AgendaContextFeedback context={context} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ScopedAgenda({ initialDate, timezone }: { initialDate: string; timezone: string }) {
  const [date, setDate] = useState(initialDate);
  const [view, setView] = useState<AgendaView>('day');
  const lifetime = useAppointmentLifecycle(JSON.stringify({ date, view, timezone }));
  const period = useMemo(() => {
    try {
      return agendaViewPeriod(date, view, timezone);
    } catch {
      return null;
    }
  }, [date, view, timezone]);
  const result = useAppointments(period?.range ?? null);
  const appointments = result.status === 'success' ? result.data : [];
  const selectDate = (next: string) => {
    if (lifetime.isCurrent()) setDate(next);
  };
  const shared = {
    appointments,
    loading: result.status === 'pending',
    error: result.error?.message,
    onRetry: () => {
      if (lifetime.isCurrent()) void result.refetch();
    },
    onSelectAppointment: (id: string) => {
      if (
        lifetime.isCurrent() &&
        appointments.some((row) => row.id === id && row.business_id === lifetime.scope?.businessId)
      )
        router.push({ pathname: '/appointments/[id]', params: { id } });
    },
  };
  return (
    <View style={styles.section}>
      <AgendaViewTabs
        value={view}
        onChange={(next) => {
          if (lifetime.isCurrent()) setView(next);
        }}
      />
      {!period ? (
        <ErrorState message="El período de la agenda no es válido." />
      ) : result.status === 'idle' ? (
        <EmptyState title="Agenda no disponible" />
      ) : view === 'month' ? (
        <AgendaMonthView
          civilMonth={date.slice(0, 7)}
          selectedDate={date}
          onSelectDate={selectDate}
          {...shared}
        />
      ) : view === 'week' ? (
        <AgendaWeekView
          civilWeekStart={period.days[0].date}
          selectedDate={date}
          onSelectDate={selectDate}
          {...shared}
        />
      ) : (
        <AgendaDayView civilDate={date} {...shared} />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing[16], gap: theme.spacing[16] },
  section: { gap: theme.spacing[16] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
});
