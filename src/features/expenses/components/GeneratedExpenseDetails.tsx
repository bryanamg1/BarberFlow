import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Badge, Button, LoadingState } from '@/components/ui';
import { usePurchaseDetail } from '@/features/purchases/hooks/usePurchaseDetail';
import { useExpenseLifecycle } from '../hooks/useExpenseLifecycle';
import type { ExpenseRow } from '../types/expense.types';
import { expenseStyles as styles } from './expensePresentation';

export function GeneratedExpenseDetails({ expense }: { expense: ExpenseRow }) {
  const lifetime = useExpenseLifecycle(`generated-expense:${expense.id}`);
  const [expanded, setExpanded] = useState(false);
  if (expense.source_type !== 'PURCHASE' || lifetime.scope?.businessId !== expense.business_id)
    return null;
  return (
    <View style={styles.section}>
      <Text style={styles.hint}>Solo lectura</Text>
      <Text style={styles.body}>Registro histórico generado por una compra.</Text>
      {expanded ? (
        <PurchaseOrigin key={expense.purchase_id} purchaseId={expense.purchase_id} />
      ) : (
        <Button
          label="Ver información de compra"
          variant="outline"
          accessibilityLabel={`Ver información de compra: ${expense.description || 'Sin descripción'}, ${expense.expense_date}`}
          onPress={() => {
            if (lifetime.isCurrent()) setExpanded(true);
          }}
        />
      )}
    </View>
  );
}

function PurchaseOrigin({ purchaseId }: { purchaseId: string | null }) {
  // Mounted on demand, not an eager full-detail request for every list row.
  const detail = usePurchaseDetail(purchaseId);
  const lifetime = useExpenseLifecycle(`expense-purchase:${purchaseId}`);
  if (detail.status === 'pending')
    return <LoadingState message="Cargando información de compra…" />;
  if (detail.status !== 'success' || !purchaseId || detail.data.purchase.id !== purchaseId)
    return (
      <View style={styles.section}>
        <Text role="status" style={styles.hint}>
          Información de compra no disponible.
        </Text>
        {detail.status === 'error' && (
          <Button
            label="Reintentar información de compra"
            variant="secondary"
            disabled={detail.isFetching}
            onPress={() => {
              if (lifetime.isCurrent()) void detail.refetch();
            }}
          />
        )}
      </View>
    );
  return (
    <View style={styles.section}>
      <Text style={styles.body}>
        Categoría: {detail.data.expense?.category_name ?? 'No disponible'}
      </Text>
      {detail.data.purchase.status === 'VOIDED' && (
        <>
          <Badge label="Compra anulada" tone="warning" />
          <Text style={styles.body}>
            El gasto histórico permanece registrado. No cuenta como gasto efectivo en su período
            original.
          </Text>
        </>
      )}
      <Button
        label="Abrir compra de origen"
        variant="outline"
        onPress={() => {
          if (lifetime.isCurrent())
            router.push(`/purchases/${encodeURIComponent(purchaseId)}` as Href);
        }}
      />
    </View>
  );
}
