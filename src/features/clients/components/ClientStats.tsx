import { useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { Card, ErrorState, LoadingState } from '@/components/ui';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';

import { clientsKeys } from '../constants/clientsKeys';
import { useClientStats } from '../hooks/useClientStats';
import { formatClientStatsDate, formatClientStatsMoney } from '../utils/clientStatsFormat';

export function ClientStats({ clientId }: { clientId: string | null }) {
  const result = useClientStats(clientId);
  const business = useBusiness();
  const auth = useAuth();
  const queryClient = useQueryClient();
  if (result.status === 'idle' || business.status !== 'success') return null;
  const { currency_code: currency, timezone } = business.data.business;

  return (
    <Card style={styles.section}>
      <Text role="heading" style={styles.heading}>
        Estadísticas del cliente
      </Text>
      {result.status === 'pending' ? (
        <LoadingState message="Cargando estadísticas…" />
      ) : result.status === 'error' ? (
        <ErrorState
          title="Estadísticas no disponibles"
          message={result.error.message}
          retrying={result.isFetching}
          onRetry={
            auth.status === 'authenticated' && clientId !== null
              ? () => {
                  void queryClient.invalidateQueries({
                    queryKey: clientsKeys.stats(
                      business.data.business.id,
                      clientId,
                      auth.user.id,
                      business.data.role,
                    ),
                    exact: true,
                  });
                }
              : undefined
          }
        />
      ) : (
        <View style={styles.section}>
          <Metric
            label="Próximo turno"
            value={
              result.data.nextAppointmentAt === null
                ? 'Sin próximo turno'
                : formatClientStatsDate(result.data.nextAppointmentAt, timezone)
            }
          />
          <Metric
            label="Última visita"
            value={
              result.data.lastVisitAt === null
                ? 'Sin visitas completadas'
                : formatClientStatsDate(result.data.lastVisitAt, timezone)
            }
          />
          <Metric label="Visitas completadas" value={result.data.completedVisits} />
          <Metric label="Ausencias" value={result.data.noShowCount} />
          <Metric label="Total de citas registradas" value={result.data.totalAppointments} />
          {business.data.role === 'OWNER' && result.data.totalSpent !== null && (
            <Metric
              label="Total gastado"
              value={formatClientStatsMoney(result.data.totalSpent, currency)}
            />
          )}
        </View>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View accessible aria-label={`${label}: ${value}`} style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing[16], minWidth: 0 },
  heading: { ...theme.typography.headingSm, color: theme.colors.textPrimary },
  row: { gap: theme.spacing[4], minWidth: 0 },
  label: { ...theme.typography.bodyMedium, color: theme.colors.textSecondary },
  value: { ...theme.typography.body, color: theme.colors.textPrimary, flexShrink: 1 },
});
