import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';
import { formatCatalogPrice } from '@/utils/formatMoney';

import { useSaleDetail } from '../hooks/useSaleDetail';

const statuses = { DRAFT: 'Borrador', COMPLETED: 'Completada', VOIDED: 'Anulada' };
const methods: Record<string, string> = {
  CASH: 'Efectivo',
  BANK_TRANSFER: 'Transferencia bancaria',
  DEBIT_CARD: 'Tarjeta de débito',
  CREDIT_CARD: 'Tarjeta de crédito',
  DIGITAL_WALLET: 'Billetera digital',
};
export function SaleDetailScreen({ saleId }: { saleId: string | null }) {
  const result = useSaleDetail(saleId),
    business = useBusiness();
  if (result.status === 'idle' || business.status !== 'success')
    return <ErrorState message="No tienes acceso a esta venta." />;
  if (result.status === 'pending') return <LoadingState message="Cargando venta…" />;
  if (result.status === 'error')
    return (
      <ErrorState
        message={result.error.message}
        onRetry={() => {
          void result.refetch();
        }}
      />
    );
  const sale = result.data,
    currency = business.data.business.currency_code,
    timezone = business.data.business.timezone;
  const date = (value: string | null) => {
    if (value === null) return 'No registrada';
    try {
      return new Intl.DateTimeFormat('es-AR', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(new Date(value));
    } catch {
      return 'Fecha no disponible';
    }
  };
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Detalle de venta
        </Text>
        <Card style={styles.section}>
          <Text style={styles.text}>Venta: {sale.id}</Text>
          <Badge label={statuses[sale.status]} />
          <Text style={styles.text}>Fecha de venta: {date(sale.sold_at)}</Text>
          <Text style={styles.hint}>Registrada: {date(sale.created_at)}</Text>
          <Text style={styles.text}>Cliente: {sale.client_id ?? 'Sin cliente'}</Text>
          <Text style={styles.text}>
            {sale.appointment_id ? `Cita: ${sale.appointment_id}` : 'Venta directa'}
          </Text>
          <Text style={styles.text}>Subtotal: {formatCatalogPrice(sale.subtotal, currency)}</Text>
          <Text style={styles.text}>Descuento: {formatCatalogPrice(sale.discount, currency)}</Text>
          <Text style={styles.text}>Total: {formatCatalogPrice(sale.total, currency)}</Text>
        </Card>
        <Text role="heading" style={styles.heading}>
          Líneas registradas
        </Text>
        {sale.sale_items.length === 0 ? (
          <EmptyState title="No hay líneas visibles" />
        ) : (
          sale.sale_items.map((line) => (
            <Card key={line.id} style={styles.section}>
              <Badge label={line.item_type === 'SERVICE' ? 'Servicio' : 'Producto'} />
              <Text style={styles.text}>{line.item_name_snapshot}</Text>
              <Text style={styles.text}>Cantidad: {line.quantity}</Text>
              <Text style={styles.text}>
                Precio unitario histórico: {formatCatalogPrice(line.unit_price_snapshot, currency)}
              </Text>
              <Text style={styles.text}>
                Importe registrado: {formatCatalogPrice(line.line_total, currency)}
              </Text>
              {line.unit_cost_snapshot !== null && (
                <Text style={styles.hint}>
                  Costo unitario histórico: {formatCatalogPrice(line.unit_cost_snapshot, currency)}
                </Text>
              )}
            </Card>
          ))
        )}
        <Text role="heading" style={styles.heading}>
          Pagos visibles
        </Text>
        {sale.payments.length === 0 ? (
          <EmptyState title="No hay pagos visibles" />
        ) : (
          sale.payments.map((payment) => (
            <Card key={payment.id} style={styles.section}>
              <Text style={styles.text}>
                Método: {methods[payment.payment_method] ?? payment.payment_method}
              </Text>
              <Text style={styles.text}>
                Importe del pago: {formatCatalogPrice(payment.amount, currency)}
              </Text>
              <Text style={styles.hint}>Fecha del pago: {date(payment.paid_at)}</Text>
              {payment.notes !== null && (
                <Text style={styles.hint}>Notas del pago: {payment.notes}</Text>
              )}
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing[16], gap: theme.spacing[16] },
  section: { gap: theme.spacing[8] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  text: { ...theme.typography.body, color: theme.colors.textPrimary, flexShrink: 1 },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary },
});
