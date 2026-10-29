import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useAuth } from '@/features/auth/context/AuthContext';
import {
  usableAppointmentId,
  useAppointmentLifecycle,
} from '@/features/appointments/hooks/useAppointmentLifecycle';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';

import { HomeFinanceSummary } from '../components/HomeFinanceSummary';
import { HomeKpis } from '../components/HomeKpis';
import { HomeLowStock } from '../components/HomeLowStock';
import { HomeNextAppointment } from '../components/HomeNextAppointment';
import { HomeTodayAppointments } from '../components/HomeTodayAppointments';
import { useHomeDashboardSummary } from '../hooks/useHomeDashboardSummary';
import { useNextAppointment } from '../hooks/useNextAppointment';

export function HomeScreen() {
  const auth = useAuth();
  const business = useBusiness();
  const lifecycle = useAppointmentLifecycle(JSON.stringify(['home-screen', business.isFetching]));
  const summaryResult = useHomeDashboardSummary();
  const nextResult = useNextAppointment();
  const role = business.status === 'success' ? business.data.role : null;
  const validContext =
    auth.status === 'authenticated' &&
    business.status === 'success' &&
    !business.isFetching &&
    usableAppointmentId(auth.user.id) &&
    usableAppointmentId(business.data.business.id) &&
    usableAppointmentId(business.data.membershipId) &&
    (role === 'OWNER' || role === 'BARBER');

  const handleOpenAppointment = (id: string) => {
    if (validContext && lifecycle.isCurrent())
      router.push({ pathname: '/appointments/[id]', params: { id } });
  };
  const handleOpenFinances = () => {
    if (validContext && role === 'OWNER' && lifecycle.isCurrent()) router.push('/finances');
  };

  const contextFeedback =
    auth.status === 'initializing' ? (
      <LoadingState message="Verificando sesión…" />
    ) : auth.status !== 'authenticated' ? (
      <EmptyState title="Inicio no disponible" />
    ) : business.status === 'pending' || business.isFetching ? (
      <LoadingState message="Cargando negocio…" />
    ) : business.status === 'error' ? (
      <ErrorState message={business.error.message} />
    ) : (
      <EmptyState title="Negocio no disponible" />
    );

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Inicio
        </Text>
        {!validContext ? (
          contextFeedback
        ) : (
          <>
            {role === 'OWNER' && <HomeKpis result={summaryResult} />}
            <HomeNextAppointment result={nextResult} onOpen={handleOpenAppointment} />
            <HomeTodayAppointments />
            {role === 'OWNER' && (
              <HomeFinanceSummary result={summaryResult} onOpenFinances={handleOpenFinances} />
            )}
            <HomeLowStock />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    padding: theme.spacing[16],
    gap: theme.spacing[24],
  },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
});
