import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { SaleHistoryRow } from '../components/SaleHistoryRow';
import { saleStatuses, saleStyles as styles } from '../components/salePresentation';
import { useSaleHistory } from '../hooks/useSaleHistory';
import { useSaleLifecycle } from '../hooks/useSaleLifecycle';
import type { SaleRow } from '../types/checkout.types';

export function SaleHistoryScreen() {
  const { scope } = useSaleLifecycle('history-screen');
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Historial de ventas
        </Text>
        {scope ? (
          <History key={JSON.stringify(scope)} />
        ) : (
          <ErrorState message="No tienes acceso al historial de ventas." />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
function History() {
  const [page, setPage] = useState(1),
    [status, setStatus] = useState<SaleRow['status']>();
  const result = useSaleHistory({ page, pageSize: 25, status });
  return (
    <View style={styles.section}>
      <View style={styles.controls}>
        {([undefined, 'DRAFT', 'COMPLETED', 'VOIDED'] as const).map((option) => (
          <Button
            key={option ?? 'all'}
            label={option ? saleStatuses[option] : 'Todas'}
            variant={option === status ? 'primary' : 'outline'}
            accessibilityState={{ selected: option === status }}
            onPress={() => {
              setPage(1);
              setStatus(option);
            }}
          />
        ))}
      </View>
      {result.status === 'pending' ? (
        <LoadingState message="Cargando ventas…" />
      ) : result.status === 'error' ? (
        <ErrorState
          message={result.error.message}
          retrying={result.isFetching}
          onRetry={() => {
            void result.refetch();
          }}
        />
      ) : result.status === 'success' ? (
        <>
          {result.data.items.length === 0 ? (
            <EmptyState
              title="No hay ventas"
              message={
                status === undefined
                  ? 'No hay ventas registradas.'
                  : 'No hay ventas para mostrar en este período o filtro.'
              }
            />
          ) : (
            result.data.items.map((sale) => (
              <SaleHistoryRow
                key={sale.id}
                sale={sale}
                onPress={() => router.push({ pathname: '/sales/[id]', params: { id: sale.id } })}
              />
            ))
          )}
          <View style={styles.controls}>
            <Button
              label="Anterior"
              variant="secondary"
              disabled={page <= 1 || result.isFetching}
              onPress={() => setPage((p) => Math.max(1, p - 1))}
            />
            <Text role="status" aria-live="polite" style={styles.text}>
              Página {page}
            </Text>
            <Button
              label="Siguiente"
              variant="secondary"
              disabled={!result.data.hasNextPage || result.isFetching}
              onPress={() => setPage((p) => p + 1)}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}
