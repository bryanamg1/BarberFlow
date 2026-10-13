import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';
import { formatCatalogPrice } from '@/utils/formatMoney';

import { servicesKeys } from '../constants/servicesKeys';
import { useServiceList } from '../hooks/useServiceList';
import type { ServiceRow } from '../repositories/servicesRepository';
import type { ServiceListParams } from '../types/service.types';

const statuses = [
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Archivados' },
  { value: 'all', label: 'Todos' },
] as const;

export function ServicesScreen() {
  const business = useBusiness();
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Servicios
        </Text>
        {business.status === 'pending' ? (
          <LoadingState message="Cargando negocio…" />
        ) : business.status === 'error' ? (
          <ErrorState message={business.error.message} />
        ) : business.status === 'success' ? (
          <BusinessServices
            key={business.data.business.id}
            businessId={business.data.business.id}
            currency={business.data.business.currency_code}
            canManage={business.data.role === 'OWNER'}
          />
        ) : (
          <EmptyState
            title="Negocio no disponible"
            message="Necesitas un negocio disponible para ver servicios."
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function BusinessServices({
  businessId,
  currency,
  canManage,
}: {
  businessId: string;
  currency: string;
  canManage: boolean;
}) {
  const [status, setStatus] = useState<Required<ServiceListParams>['status']>('active');
  const [page, setPage] = useState(1);
  const params = { page, pageSize: 25, status };
  const result = useServiceList(params);
  const queryClient = useQueryClient();

  return (
    <View style={styles.section}>
      {canManage && <Button label="Crear servicio" onPress={() => router.push('/services/new')} />}
      <View style={styles.controls}>
        {statuses.map((option) => (
          <Button
            key={option.value}
            label={option.label}
            variant={status === option.value ? 'primary' : 'outline'}
            accessibilityState={{ selected: status === option.value }}
            onPress={() => {
              if (status !== option.value) setPage(1);
              setStatus(option.value);
            }}
          />
        ))}
      </View>
      {result.status === 'pending' ? (
        <LoadingState message="Cargando servicios…" />
      ) : result.status === 'idle' ? (
        <EmptyState title="Servicios no disponibles" />
      ) : result.status === 'error' ? (
        <ErrorState
          message={result.error.message}
          retrying={result.isFetching}
          onRetry={() => {
            void queryClient.invalidateQueries({
              queryKey: servicesKeys.list(businessId, params),
              exact: true,
            });
          }}
        />
      ) : (
        <View style={styles.section}>
          {result.data.items.length === 0 ? (
            <EmptyState
              title={
                status === 'active'
                  ? 'No hay servicios activos.'
                  : status === 'inactive'
                    ? 'No hay servicios archivados.'
                    : 'No hay servicios registrados.'
              }
            />
          ) : (
            result.data.items.map((service) => (
              <ServiceListItem
                key={service.id}
                service={service}
                currency={currency}
                canManage={canManage}
              />
            ))
          )}
          <View style={styles.controls}>
            <Button
              label="Anterior"
              variant="secondary"
              disabled={page <= 1}
              onPress={() => {
                if (page > 1) setPage(page - 1);
              }}
            />
            <Text role="status" aria-live="polite" style={styles.secondary}>
              Página {page}
            </Text>
            <Button
              label="Siguiente"
              variant="secondary"
              disabled={!result.data.hasNextPage}
              onPress={() => {
                if (result.data.hasNextPage) setPage(page + 1);
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function ServiceListItem({
  service,
  currency,
  canManage,
}: {
  service: ServiceRow;
  currency: string;
  canManage: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const { width } = useWindowDimensions();
  const state = service.is_active ? 'Activo' : 'Archivado';
  const price = formatCatalogPrice(service.price, currency);
  const label = `${service.name}, ${price}, ${service.duration_minutes} minutos, ${state}`;
  const content = (
    <>
      <Text style={styles.name}>{service.name}</Text>
      <View style={styles.metadata}>
        <Text style={styles.secondary}>{price}</Text>
        <Text style={styles.secondary}>{service.duration_minutes} minutos</Text>
        <Badge label={state} tone={service.is_active ? 'success' : 'neutral'} />
      </View>
    </>
  );

  if (!canManage)
    return (
      <View accessible aria-label={label} style={[styles.row, width >= 768 && styles.wideRow]}>
        {content}
      </View>
    );
  return (
    <Pressable
      accessible
      role="button"
      aria-label={`Editar servicio ${label}`}
      accessibilityHint="Abre la edición del servicio"
      onPress={() => router.push({ pathname: '/services/[id]/edit', params: { id: service.id } })}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.row,
        width >= 768 && styles.wideRow,
        pressed && styles.pressedRow,
        focused && styles.focusedRow,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    padding: theme.spacing[16],
    gap: theme.spacing[24],
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
  },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
  section: { gap: theme.spacing[16] },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing[8] },
  secondary: { ...theme.typography.body, color: theme.colors.textSecondary },
  name: { ...theme.typography.bodyLg, color: theme.colors.textPrimary, flexShrink: 1 },
  metadata: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing[12],
  },
  row: {
    minHeight: theme.sizing.touchTarget,
    padding: theme.spacing[16],
    gap: theme.spacing[12],
    borderRadius: theme.radius.card,
    borderWidth: theme.borderWidths.thin,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceRaised,
    ...theme.shadows.raised,
  },
  wideRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pressedRow: { backgroundColor: theme.colors.surfaceStrong },
  focusedRow: {
    borderColor: theme.colors.primary,
    ...Platform.select({
      web: {
        outlineStyle: 'solid',
        outlineColor: theme.colors.primary,
        outlineWidth: theme.borderWidths.thin,
        outlineOffset: theme.spacing[4],
      },
    }),
  },
});
