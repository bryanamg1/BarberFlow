import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';

import { clientsKeys } from '../constants/clientsKeys';
import { useClientDetail, type UseClientDetailResult } from '../hooks/useClientDetail';

export function ClientDetailScreen({ clientId }: { clientId: string | null }) {
  const business = useBusiness();
  const result = useClientDetail(clientId);
  const queryClient = useQueryClient();

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Detalle de cliente
        </Text>
        <Button
          label="Volver a clientes"
          variant="secondary"
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/clients');
          }}
        />
        {result.status === 'pending' ? (
          <LoadingState message="Cargando cliente…" />
        ) : result.status === 'idle' ? (
          <EmptyState title="Cliente no disponible" />
        ) : result.status === 'error' ? (
          result.error.code === 'CLIENT_NOT_FOUND' ? (
            <EmptyState title="Cliente no encontrado" message={result.error.message} />
          ) : (
            <ErrorState
              message={result.error.message}
              retrying={result.isFetching}
              onRetry={
                business.status === 'success' && clientId !== null
                  ? () => {
                      void queryClient.invalidateQueries({
                        queryKey: clientsKeys.detail(business.data.business.id, clientId),
                        exact: true,
                      });
                    }
                  : undefined
              }
            />
          )
        ) : business.status === 'success' ? (
          <ClientInformation result={result} timezone={business.data.business.timezone} />
        ) : (
          <EmptyState title="Cliente no disponible" />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ClientInformation({
  result,
  timezone,
}: {
  result: Extract<UseClientDetailResult, { status: 'success' }>;
  timezone: string;
}) {
  const client = result.data;
  const name =
    client.last_name === null ? client.first_name : `${client.first_name} ${client.last_name}`;
  return (
    <View style={styles.section}>
      <Text role="heading" style={styles.name}>
        {name}
      </Text>
      <Badge
        label={client.is_active ? 'Activo' : 'Archivado'}
        tone={client.is_active ? 'success' : 'neutral'}
      />
      <Card style={styles.section}>
        <InfoRow label="Nombre" value={client.first_name} />
        <InfoRow label="Apellido" value={client.last_name} />
        <InfoRow label="Teléfono" value={client.phone} />
        <InfoRow label="Email" value={client.email} />
        <InfoRow label="Instagram" value={client.instagram} />
        <InfoRow label="Fecha de nacimiento" value={client.birth_date} />
        <InfoRow label="Notas" value={client.notes} />
        <InfoRow label="Preferencias" value={client.preferences} />
      </Card>
      <Button
        label="Editar cliente"
        onPress={() => router.push({ pathname: '/clients/[id]/edit', params: { id: client.id } })}
      />
      <Card style={styles.section}>
        <Text role="heading" style={styles.metadataHeading}>
          Datos del registro
        </Text>
        <InfoRow label="ID del cliente" value={client.id} secondary />
        <InfoRow label="ID del negocio" value={client.business_id} secondary />
        <InfoRow
          label={`Creado (${timezone})`}
          value={auditDate(client.created_at, timezone)}
          secondary
        />
        <InfoRow
          label={`Actualizado (${timezone})`}
          value={auditDate(client.updated_at, timezone)}
          secondary
        />
      </Card>
    </View>
  );
}

function InfoRow({
  label,
  value,
  secondary = false,
}: {
  label: string;
  value: string | null;
  secondary?: boolean;
}) {
  const display = value ?? 'Sin datos';
  return (
    <View accessible aria-label={`${label}: ${display}`} style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={[styles.value, secondary && styles.secondary]}>
        {display}
      </Text>
    </View>
  );
}

function auditDate(value: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle: 'h23',
    }).format(new Date(value));
  } catch {
    // Do not silently substitute the device timezone for unavailable audit metadata.
    return 'Fecha no disponible';
  }
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
  name: { ...theme.typography.heading, color: theme.colors.textPrimary },
  section: { gap: theme.spacing[16], minWidth: 0 },
  row: { gap: theme.spacing[8], minWidth: 0 },
  label: { ...theme.typography.bodyMedium, color: theme.colors.textSecondary },
  value: { ...theme.typography.body, color: theme.colors.textPrimary, flexShrink: 1 },
  secondary: { ...theme.typography.caption, color: theme.colors.textSecondary },
  metadataHeading: { ...theme.typography.bodyMedium, color: theme.colors.textSecondary },
});
