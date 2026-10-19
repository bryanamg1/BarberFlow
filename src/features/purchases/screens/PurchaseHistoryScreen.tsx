import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { formatCatalogPrice } from '@/utils/formatMoney';

import { PurchaseAccess } from '../components/PurchaseAccess';
import {
  purchaseDate,
  purchaseStyles as styles,
  purchaseStatusLabel,
} from '../components/purchasePresentation';
import { usePurchaseHistory } from '../hooks/usePurchaseHistory';
import { usePurchaseScope } from '../hooks/usePurchaseScope';

export function PurchaseHistoryScreen() {
  const scope = usePurchaseScope();
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Compras
        </Text>
        {scope ? <History key={JSON.stringify(scope)} /> : <PurchaseAccess />}
      </ScrollView>
    </SafeAreaView>
  );
}
function History() {
  const [page, setPage] = useState(1);
  const result = usePurchaseHistory({ page, pageSize: 25 });
  const business = useBusiness();
  if (business.status !== 'success') return null;
  if (result.status === 'pending') return <LoadingState message="Cargando compras…" />;
  if (result.status === 'error')
    return (
      <ErrorState
        message={result.error.message}
        retrying={result.isFetching}
        onRetry={() => {
          void result.refetch();
        }}
      />
    );
  if (result.status !== 'success') return <EmptyState title="Compras no disponibles" />;
  const { currency_code, timezone } = business.data.business;
  return (
    <View style={styles.section}>
      {result.data.items.length === 0 ? (
        <EmptyState title="No hay compras registradas" />
      ) : (
        result.data.items.map((item) => (
          <HistoryRow
            key={item.id}
            label={`${item.supplier}, ${purchaseStatusLabel[item.status]}, ${formatCatalogPrice(item.total, currency_code)}, ${purchaseDate(item.purchased_at, timezone)}`}
            onPress={() => router.push({ pathname: '/purchases/[id]', params: { id: item.id } })}
          >
            <Text style={styles.title}>{item.supplier}</Text>
            <Text style={styles.body}>{formatCatalogPrice(item.total, currency_code)}</Text>
            <Text style={styles.secondary}>{purchaseDate(item.purchased_at, timezone)}</Text>
            <Badge label={purchaseStatusLabel[item.status]} />
          </HistoryRow>
        ))
      )}
      <View style={styles.controls}>
        <Button
          label="Anterior"
          variant="secondary"
          disabled={page <= 1}
          onPress={() => setPage((p) => Math.max(1, p - 1))}
        />
        <Text role="status" style={styles.body}>
          Página {page}
        </Text>
        <Button
          label="Siguiente"
          variant="secondary"
          disabled={!result.data.hasNextPage}
          onPress={() => setPage((p) => p + 1)}
        />
      </View>
    </View>
  );
}
function HistoryRow({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <Pressable
      role="button"
      accessibilityLabel={`Ver compra: ${label}`}
      accessibilityHint="Abre el detalle de la compra"
      onPress={onPress}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, focus && styles.focused]}
    >
      {children}
    </Pressable>
  );
}
