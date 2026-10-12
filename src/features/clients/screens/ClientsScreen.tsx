import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, EmptyState, ErrorState, LoadingState, SearchInput } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';

import { clientsKeys } from '../constants/clientsKeys';
import type { UseClientsResult } from '../hooks/clientHook.types';
import { useClientSearch } from '../hooks/useClientSearch';
import { useClients } from '../hooks/useClients';
import type { ClientRow } from '../repositories/clientsRepository';
import type { ClientListParams, ClientListStatus, ClientSearchParams } from '../types/client.types';

const statuses = [
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Archivados' },
  { value: 'all', label: 'Todos' },
] as const;

export function ClientsScreen() {
  const business = useBusiness();
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Clientes
        </Text>
        {business.status === 'pending' ? (
          <LoadingState message="Cargando negocio…" />
        ) : business.status === 'error' ? (
          <ErrorState message={business.error.message} />
        ) : business.status === 'success' ? (
          // A new business owns fresh controls; no previous result is copied into local state.
          <BusinessClients key={business.data.business.id} businessId={business.data.business.id} />
        ) : (
          <EmptyState
            title="Negocio no disponible"
            message="Necesitas un negocio disponible para ver clientes."
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function BusinessClients({ businessId }: { businessId: string }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ClientListStatus>('active');
  const [page, setPage] = useState(1);
  const term = search.trim();
  const params = { page, pageSize: 25, status };

  return (
    <View style={styles.section}>
      <Button label="Crear cliente" onPress={() => router.push('/clients/new')} />
      <SearchInput
        label="Buscar clientes"
        placeholder="Escribe al menos 2 caracteres"
        value={search}
        onChangeText={(value) => {
          if (value.trim() !== term) setPage(1);
          setSearch(value);
        }}
      />
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
      {term.length >= 2 ? (
        <SearchResults
          businessId={businessId}
          params={{ ...params, term }}
          onPageChange={setPage}
        />
      ) : (
        <ListResults businessId={businessId} params={params} onPageChange={setPage} />
      )}
    </View>
  );
}

type ResultsProps<T> = {
  businessId: string;
  params: T;
  onPageChange: (page: number) => void;
};

// Mount only the active data hook: each hook owns its own enabled contract.
function ListResults({
  businessId,
  params,
  onPageChange,
}: ResultsProps<Required<ClientListParams>>) {
  const result = useClients(params);
  return (
    <Results
      result={result}
      queryKey={clientsKeys.list(businessId, params)}
      page={params.page}
      status={params.status}
      searching={false}
      onPageChange={onPageChange}
    />
  );
}

function SearchResults({
  businessId,
  params,
  onPageChange,
}: ResultsProps<Required<ClientSearchParams>>) {
  const result = useClientSearch(params);
  return (
    <Results
      result={result}
      queryKey={clientsKeys.search(businessId, params)}
      page={params.page}
      status={params.status}
      searching
      onPageChange={onPageChange}
    />
  );
}

function Results({
  result,
  queryKey,
  page,
  status,
  searching,
  onPageChange,
}: {
  result: UseClientsResult;
  queryKey: QueryKey;
  page: number;
  status: ClientListStatus;
  searching: boolean;
  onPageChange: (page: number) => void;
}) {
  const queryClient = useQueryClient();
  if (result.status === 'pending') return <LoadingState message="Cargando clientes…" />;
  if (result.status === 'idle') return <EmptyState title="Clientes no disponibles" />;
  if (result.status === 'error') {
    return (
      <ErrorState
        message={result.error.message}
        retrying={result.isFetching}
        onRetry={() => {
          // Retry the mounted read through its public key without extending the hooks or bypassing them.
          void queryClient.invalidateQueries({ queryKey, exact: true });
        }}
      />
    );
  }
  return (
    <View style={styles.section}>
      {result.data.items.length === 0 ? (
        <EmptyState
          title={
            searching
              ? 'No encontramos clientes para esta búsqueda.'
              : status === 'active'
                ? 'No hay clientes activos.'
                : status === 'inactive'
                  ? 'No hay clientes archivados.'
                  : 'No hay clientes todavía.'
          }
        />
      ) : (
        result.data.items.map((client) => <ClientListItem key={client.id} client={client} />)
      )}
      <View style={styles.controls}>
        <Button
          label="Anterior"
          variant="secondary"
          disabled={page <= 1}
          onPress={() => {
            if (page > 1) onPageChange(page - 1);
          }}
        />
        <Text role="status" aria-live="polite" style={styles.page}>
          Página {page}
        </Text>
        <Button
          label="Siguiente"
          variant="secondary"
          disabled={!result.data.hasNextPage}
          onPress={() => {
            if (result.data.hasNextPage) onPageChange(page + 1);
          }}
        />
      </View>
    </View>
  );
}

function ClientListItem({ client }: { client: ClientRow }) {
  const [focused, setFocused] = useState(false);
  const name =
    client.last_name === null ? client.first_name : `${client.first_name} ${client.last_name}`;
  const state = client.is_active ? 'Activo' : 'Archivado';
  return (
    <Pressable
      accessible
      role="button"
      aria-label={`Ver cliente ${name}, ${state}`}
      accessibilityHint="Abre el detalle del cliente"
      onPress={() => router.push({ pathname: '/clients/[id]', params: { id: client.id } })}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.pressedRow,
        focused && styles.focusedRow,
      ]}
    >
      <Text style={styles.name}>{name}</Text>
      <Badge label={state} tone={client.is_active ? 'success' : 'neutral'} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    padding: theme.spacing[16],
    gap: theme.spacing[24],
    width: '100%',
    // HD-007 approved bound; shared responsive infrastructure belongs to BF-290.
    maxWidth: 1200,
    alignSelf: 'center',
  },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
  section: { gap: theme.spacing[16] },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing[8] },
  page: { ...theme.typography.body, color: theme.colors.textSecondary },
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
  name: { ...theme.typography.bodyLg, color: theme.colors.textPrimary },
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
