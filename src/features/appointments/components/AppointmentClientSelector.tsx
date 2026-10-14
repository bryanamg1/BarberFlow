import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  SearchInput,
} from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { clientsKeys } from '@/features/clients/constants/clientsKeys';
import type { UseClientsResult } from '@/features/clients/hooks/clientHook.types';
import { useClientDetail } from '@/features/clients/hooks/useClientDetail';
import { useClientSearch } from '@/features/clients/hooks/useClientSearch';
import { useClients } from '@/features/clients/hooks/useClients';
import type { ClientRow } from '@/features/clients/repositories/clientsRepository';
import { theme } from '@/theme';

export type AppointmentClientSelectorProps = {
  value: string | null;
  onChange: (clientId: string | null) => void;
};

// The parent owns the client ID. Local state contains only search and pagination controls.
export function AppointmentClientSelector({ value, onChange }: AppointmentClientSelectorProps) {
  const business = useBusiness();
  const businessId = business.status === 'success' ? business.data.business.id : null;
  const previousBusiness = useRef(businessId);
  useEffect(() => {
    const previous = previousBusiness.current;
    previousBusiness.current = businessId;
    if (previous !== null && previous !== businessId && value !== null) onChange(null);
  }, [businessId, onChange, value]);

  if (business.status === 'pending') return <LoadingState message="Cargando negocio…" />;
  if (business.status === 'error') return <ErrorState message={business.error.message} />;
  if (business.status !== 'success') return <EmptyState title="Negocio no disponible" />;
  return (
    <Selector
      key={business.data.business.id}
      {...{ value, onChange }}
      businessId={business.data.business.id}
    />
  );
}

function Selector({
  value,
  onChange,
  businessId,
}: AppointmentClientSelectorProps & { businessId: string }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const term = search.trim();
  return (
    <View style={styles.section}>
      <Text role="heading" style={styles.heading}>
        Cliente
      </Text>
      <SelectedClient value={value} businessId={businessId} />
      <SearchInput
        label="Buscar clientes"
        placeholder="Escribe al menos 2 caracteres"
        value={search}
        onChangeText={(text) => {
          if (text.trim() !== term) setPage(1);
          setSearch(text);
        }}
      />
      {term.length >= 2 ? (
        <SearchResults {...{ businessId, value, onChange, page, term }} onPageChange={setPage} />
      ) : (
        <ListResults {...{ businessId, value, onChange, page }} onPageChange={setPage} />
      )}
    </View>
  );
}

function SelectedClient({ value, businessId }: { value: string | null; businessId: string }) {
  const result = useClientDetail(value);
  const queryClient = useQueryClient();
  if (value === null) return <Text style={styles.text}>Sin cliente seleccionado</Text>;
  if (result.status === 'pending') return <LoadingState message="Cargando cliente seleccionado…" />;
  if (result.status === 'error')
    return (
      <ErrorState
        title="Cliente seleccionado no disponible"
        message={result.error.message}
        retrying={result.isFetching}
        onRetry={() => {
          void queryClient.invalidateQueries({
            queryKey: clientsKeys.detail(businessId, value),
            exact: true,
          });
        }}
      />
    );
  if (result.status !== 'success' || result.data.business_id !== businessId)
    return <EmptyState title="Cliente seleccionado no disponible" />;
  return (
    <Card style={styles.section}>
      <Text style={styles.text}>Cliente seleccionado: {clientName(result.data)}</Text>
      {!result.data.is_active && (
        <>
          <Badge label="Archivado" />
          <Text style={styles.hint}>
            Se conserva el cliente histórico hasta que selecciones otro.
          </Text>
        </>
      )}
    </Card>
  );
}

type ResultsProps = AppointmentClientSelectorProps & {
  businessId: string;
  page: number;
  onPageChange: (page: number) => void;
};

function ListResults(props: ResultsProps) {
  const params = { page: props.page, pageSize: 25, status: 'active' } as const;
  const result = useClients(params);
  return (
    <Results {...props} result={result} queryKey={clientsKeys.list(props.businessId, params)} />
  );
}

function SearchResults({ term, ...props }: ResultsProps & { term: string }) {
  const params = { term, page: props.page, pageSize: 25, status: 'active' } as const;
  const result = useClientSearch(params);
  return (
    <Results {...props} result={result} queryKey={clientsKeys.search(props.businessId, params)} />
  );
}

function Results({
  result,
  queryKey,
  businessId,
  value,
  onChange,
  page,
  onPageChange,
}: ResultsProps & {
  result: UseClientsResult;
  queryKey: QueryKey;
}) {
  const queryClient = useQueryClient();
  if (result.status === 'pending') return <LoadingState message="Cargando clientes…" />;
  if (result.status === 'idle') return <EmptyState title="Clientes no disponibles" />;
  if (result.status === 'error')
    return (
      <ErrorState
        message={result.error.message}
        retrying={result.isFetching}
        onRetry={() => {
          void queryClient.invalidateQueries({ queryKey, exact: true });
        }}
      />
    );
  const items = [
    ...new Map(
      result.data.items
        .filter((client) => client.is_active && client.business_id === businessId)
        .map((client) => [client.id, client]),
    ).values(),
  ];
  return (
    <View style={styles.section}>
      {items.length === 0 ? (
        <EmptyState title="No hay clientes activos para seleccionar." />
      ) : (
        items.map((client) => (
          <Button
            key={client.id}
            label={clientName(client)}
            accessibilityLabel={`Seleccionar cliente: ${clientName(client)}`}
            variant={value === client.id ? 'primary' : 'outline'}
            accessibilityState={{ selected: value === client.id }}
            disabled={result.isFetching || value === client.id}
            onPress={() => onChange(client.id)}
          />
        ))
      )}
      <View style={styles.controls}>
        <Button
          label="Anterior"
          variant="secondary"
          disabled={page <= 1 || result.isFetching}
          onPress={() => {
            if (page > 1) onPageChange(page - 1);
          }}
        />
        <Text role="status" aria-live="polite" style={styles.text}>
          Página {page}
        </Text>
        <Button
          label="Siguiente"
          variant="secondary"
          disabled={!result.data.hasNextPage || result.isFetching}
          onPress={() => {
            if (result.data.hasNextPage) onPageChange(page + 1);
          }}
        />
      </View>
    </View>
  );
}

function clientName(client: ClientRow) {
  return [client.first_name, client.last_name].filter(Boolean).join(' ');
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing[16] },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing[8] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  text: { ...theme.typography.body, color: theme.colors.textPrimary },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary },
});
