import { useHeaderHeight } from 'expo-router/react-navigation';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { theme } from '@/theme';

import { BusinessHoursForm } from '../components/BusinessHoursForm';
import { useBusiness } from '../context/BusinessContext';
import { useBusinessHours } from '../hooks/useBusinessHours';

export function BusinessHoursScreen() {
  const context = useBusiness();
  const headerHeight = useHeaderHeight();
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.screen}
        enabled={Platform.OS !== 'web'}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={headerHeight}
      >
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Text role="heading" style={styles.heading}>
            Horarios de atención
          </Text>
          {context.status === 'success' && context.data.role === 'OWNER' ? (
            <HoursEditor
              key={JSON.stringify([context.data.business.id, context.data.membershipId])}
              timezone={context.data.business.timezone}
            />
          ) : context.status === 'pending' ? (
            <LoadingState message="Cargando negocio…" />
          ) : context.status === 'error' ? (
            <ErrorState message={context.error.message} />
          ) : (
            <EmptyState
              title="Acceso restringido"
              message="Solo un OWNER puede gestionar los horarios."
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
function HoursEditor({ timezone }: { timezone: string }) {
  const { query, mutation, scope, retry } = useBusinessHours();
  if (!scope) return <EmptyState title="Horarios no disponibles" />;
  if (query.isError)
    return (
      <ErrorState
        message="No se pudieron cargar los horarios."
        retrying={query.isFetching}
        onRetry={() => {
          void retry();
        }}
      />
    );
  if (query.isSuccess)
    return (
      <BusinessHoursForm
        key={JSON.stringify(scope)}
        initial={query.data}
        timezone={timezone}
        mutation={mutation}
      />
    );
  return <LoadingState message="Cargando horarios…" />;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing[16], gap: theme.spacing[24] },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
});
