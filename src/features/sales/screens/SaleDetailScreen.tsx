import { useEffect, useRef } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { formatCatalogPrice } from '@/utils/formatMoney';

import { useSaleDetail } from '../hooks/useSaleDetail';
import { useSaleLifecycle } from '../hooks/useSaleLifecycle';
import { useSaleCorrectionDetail } from '../hooks/useSaleCorrectionDetail';
import { useVoidSale } from '../hooks/useVoidSale';
import { SaleVoidAction } from '../components/SaleVoidAction';
import { SaleCorrectionContent } from '../components/SaleCorrectionContent';
import {
  saleDate,
  saleStatuses as statuses,
  saleStyles as styles,
} from '../components/salePresentation';

const methods: Record<string, string> = {
  CASH: 'Efectivo',
  BANK_TRANSFER: 'Transferencia bancaria',
  DEBIT_CARD: 'Tarjeta de débito',
  CREDIT_CARD: 'Tarjeta de crédito',
  DIGITAL_WALLET: 'Billetera digital',
};
export function SaleDetailScreen({ saleId }: { saleId: string | null }) {
  const { scope } = useSaleLifecycle(saleId);
  return scope ? (
    <Detail key={JSON.stringify([scope, saleId])} saleId={saleId} />
  ) : (
    <ErrorState message="No tienes acceso a esta venta." />
  );
}
function Detail({ saleId }: { saleId: string | null }) {
  const result = useSaleDetail(saleId),
    business = useBusiness();
  const { scope } = useSaleLifecycle(saleId);
  const loaded = result.status === 'success' ? result.data : null;
  const eligible = business.status === 'success' && !business.isFetching && !result.isFetching;
  const mutation = useVoidSale(saleId, loaded, eligible);
  const adopted =
    mutation.status === 'success'
      ? { ...mutation.data.sale, sale_items: mutation.data.items, payments: mutation.data.payments }
      : null;
  const data =
    result.error?.code === 'ACCESS_DENIED' || result.error?.code === 'NOT_FOUND'
      ? null
      : (adopted ?? loaded);
  const correction = useSaleCorrectionDetail(adopted ? null : data);
  const invalidStatus = mutation.error?.code === 'INVALID_STATUS';
  const refreshDetail = result.refetch;
  const handled = useRef(false);
  useEffect(() => {
    if (!invalidStatus) handled.current = false;
    else if (!handled.current) {
      handled.current = true;
      void refreshDetail();
    }
  }, [invalidStatus, refreshDetail]);
  if (result.status === 'idle' || business.status !== 'success')
    return <ErrorState message="No tienes acceso a esta venta." />;
  if (!data && result.status === 'pending') return <LoadingState message="Cargando venta…" />;
  if (!data && result.status === 'error')
    return (
      <ErrorState
        message={result.error.message}
        onRetry={() => {
          void result.refetch();
        }}
      />
    );
  if (!data || !scope) return null;
  const sale = data,
    currency = business.data.business.currency_code,
    timezone = business.data.business.timezone;
  const date = (value: string | null) => saleDate(value, timezone);
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
        {scope.role === 'OWNER' && (
          <SaleVoidAction
            available={sale.status === 'COMPLETED' && eligible && mutation.status !== 'pending'}
            pending={mutation.status === 'pending'}
            error={mutation.error}
            success={mutation.status === 'success'}
            onReset={mutation.reset}
            onConfirm={(reason) => {
              void mutation.confirm(reason).catch(() => undefined);
            }}
          />
        )}
        {scope.role === 'OWNER' &&
          sale.status === 'VOIDED' &&
          (mutation.status === 'success' ? (
            <SaleCorrectionContent
              data={mutation.data}
              items={sale.sale_items}
              userId={scope.userId}
              timezone={timezone}
            />
          ) : correction.status === 'pending' ? (
            <LoadingState message="Cargando anulación…" />
          ) : correction.status === 'error' ? (
            <ErrorState
              message={correction.error.message}
              onRetry={() => {
                void correction.refetch();
              }}
            />
          ) : correction.status === 'success' ? (
            <SaleCorrectionContent
              data={correction.data}
              items={sale.sale_items}
              userId={scope.userId}
              timezone={timezone}
            />
          ) : null)}
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
