import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';
import { formatMoney } from '@/utils/formatMoney';

import { useCheckoutSummary } from '../hooks/useCheckoutSummary';
import { validCheckoutMoney } from '../store/checkoutDraftStore';
import type { CheckoutServiceEligibility } from './CheckoutServiceItems';

export function CheckoutSummary({
  onEligibilityChange,
}: {
  onEligibilityChange?: (value: CheckoutServiceEligibility) => void;
}) {
  const summary = useCheckoutSummary();
  const business = useBusiness();
  const callback = useRef(onEligibilityChange);
  const userId = summary.scope?.userId;
  const businessId = summary.scope?.businessId;
  const membershipId = summary.scope?.membershipId;
  const operationId = summary.draft?.operationId;
  useEffect(() => {
    callback.current = onEligibilityChange;
  }, [onEligibilityChange]);
  useEffect(() => {
    callback.current?.({
      scope: userId && businessId && membershipId ? { userId, businessId, membershipId } : null,
      operationId: operationId ?? null,
      eligible: summary.eligible,
    });
  }, [userId, businessId, membershipId, operationId, summary.eligible]);
  if (!summary.draft || business.status !== 'success')
    return <EmptyState title="Sin checkout activo" />;
  const currency = business.data.business.currency_code;
  return (
    <Card style={styles.section}>
      <Text role="heading" style={styles.heading}>
        Resumen estimado
      </Text>
      <Text style={styles.hint}>
        Los importes y el stock se confirman en el servidor al cobrar.
      </Text>
      {summary.status === 'empty' && <EmptyState title="Agrega al menos una línea al checkout" />}
      {summary.lines.map((line, index) => (
        <View key={line.lineId} style={styles.line}>
          <Text style={styles.text}>
            {index + 1}. {line.itemType === 'SERVICE' ? 'Servicio' : 'Producto'}:{' '}
            {line.name ?? 'No disponible'}
          </Text>
          <Text style={styles.hint}>
            {line.inputValid
              ? `Cantidad: ${line.quantity}`
              : 'Cantidad o precio ingresado no válido'}
          </Text>
          <Text style={styles.hint}>
            Precio unitario estimado:{' '}
            {line.unitPrice !== null && validCheckoutMoney(line.unitPrice)
              ? formatMoney(line.unitPrice, currency)
              : 'No disponible'}
          </Text>
          <Text style={styles.hint}>
            Importe estimado de línea {index + 1}:{' '}
            {line.lineTotal !== null ? formatMoney(line.lineTotal, currency) : 'No disponible'}
          </Text>
          {line.catalogStatus === 'unavailable' && (
            <Text role="alert" style={styles.hint}>
              Referencia no disponible; la línea se conserva.
            </Text>
          )}
          {line.stock && (
            <Text style={styles.hint}>
              {line.stock.status === 'sufficient'
                ? `Stock suficiente · demanda total ${line.stock.demand}`
                : line.stock.status === 'insufficient'
                  ? `Stock insuficiente · demanda total ${line.stock.demand}`
                  : line.stock.status === 'loading'
                    ? 'Stock pendiente de consulta'
                    : 'Stock no disponible'}
            </Text>
          )}
        </View>
      ))}
      {summary.status === 'loading' && (
        <LoadingState message="Consultando referencias o stock del resumen…" />
      )}
      {summary.status === 'error' && (
        <ErrorState message="No se pudo resolver el catálogo o stock del resumen." />
      )}
      {summary.status === 'unavailable' && (
        <Text role="alert" style={styles.hint}>
          Hay referencias o stock no disponibles.
        </Text>
      )}
      <Text style={styles.text}>
        Subtotal estimado:{' '}
        {summary.subtotal !== null ? formatMoney(summary.subtotal, currency) : 'No disponible'}
      </Text>
      <Text style={styles.text}>
        Descuento ingresado:{' '}
        {validCheckoutMoney(summary.discountAmount)
          ? formatMoney(summary.discountAmount, currency)
          : summary.discountAmount}
      </Text>
      {!summary.discountValid && (
        <Text role="alert" style={styles.hint}>
          {summary.discountExceedsSubtotal
            ? 'El descuento supera el subtotal. Corrígelo explícitamente; se conserva el valor ingresado.'
            : 'Descuento no válido. Ingresa un decimal no negativo con dos posiciones.'}
        </Text>
      )}
      <Text style={styles.text}>
        Total estimado:{' '}
        {summary.total !== null ? formatMoney(summary.total, currency) : 'No disponible'}
      </Text>
      {summary.status === 'invalid' && (
        <Text role="alert" style={styles.hint}>
          Revisa las líneas, los importes y el stock.
        </Text>
      )}
      {summary.status === 'blocked' && (
        <Text style={styles.hint}>
          La intención está bloqueada mientras se resuelve el checkout.
        </Text>
      )}
      <Text role="status" aria-live="polite" style={styles.hint}>
        {summary.eligible
          ? 'Resumen listo para revisión'
          : 'El resumen requiere revisión antes de continuar'}
      </Text>
    </Card>
  );
}
const styles = StyleSheet.create({
  section: { gap: theme.spacing[16] },
  line: { gap: theme.spacing[8] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  text: { ...theme.typography.body, color: theme.colors.textPrimary },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary },
});
