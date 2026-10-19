import { Text, View } from 'react-native';

import { Badge, Card } from '@/components/ui';
import { formatCatalogPrice } from '@/utils/formatMoney';

import type { PurchaseDetailData } from '../types/purchaseRead.types';
import {
  purchaseDate,
  purchaseStyles as styles,
  purchaseStatusLabel,
} from './purchasePresentation';

export function PurchaseDetailContent({
  data,
  currency,
  timezone,
  wide,
}: {
  data: PurchaseDetailData;
  currency: string;
  timezone: string;
  wide: boolean;
}) {
  const { purchase, items, expense, voidInfo } = data;
  return (
    <View style={styles.section}>
      <Card style={styles.section}>
        <Text role="heading" style={styles.title}>
          {purchase.supplier}
        </Text>
        <Badge label={purchaseStatusLabel[purchase.status]} />
        <Text style={styles.body}>
          Fecha de compra: {purchaseDate(purchase.purchased_at, timezone)}
        </Text>
        <Text style={styles.body}>Total: {formatCatalogPrice(purchase.total, currency)}</Text>
        {purchase.notes !== null && <Text style={styles.body}>Notas: {purchase.notes}</Text>}
      </Card>
      <View style={wide ? styles.wide : styles.section}>
        <View style={styles.column}>
          <Text role="heading" style={styles.title}>
            Productos comprados
          </Text>
          {items.length === 0 ? (
            <Text style={styles.secondary}>Items históricos no disponibles</Text>
          ) : (
            items.map((item) => (
              <Card key={item.id} style={styles.section}>
                <Text style={styles.title}>{item.product_name_snapshot}</Text>
                <Text style={styles.body}>Cantidad: {item.quantity}</Text>
                <Text style={styles.body}>
                  Costo unitario histórico: {formatCatalogPrice(item.unit_cost_snapshot, currency)}
                </Text>
                <Text style={styles.body}>
                  Importe: {formatCatalogPrice(item.line_total, currency)}
                </Text>
              </Card>
            ))
          )}
        </View>
        <View style={styles.column}>
          <Card style={styles.section}>
            <Text role="heading" style={styles.title}>
              Gasto original
            </Text>
            {expense ? (
              <>
                <Text style={styles.body}>
                  Importe registrado: {formatCatalogPrice(expense.amount, currency)}
                </Text>
                <Text style={styles.body}>Fecha del gasto: {expense.expense_date}</Text>
                <Text style={styles.body}>
                  Categoría: {expense.category_name ?? 'Categoría no disponible'}
                </Text>
                <Text style={styles.body}>
                  Medio de pago: {paymentLabel(expense.payment_method)}
                </Text>
              </>
            ) : (
              <Text style={styles.secondary}>Gasto histórico no disponible</Text>
            )}
            {purchase.status === 'VOIDED' && (
              <Text style={styles.secondary}>
                Este gasto se conserva en el historial, pero ya no cuenta en los totales efectivos
                de su período original. Esta anulación no devuelve dinero.
              </Text>
            )}
          </Card>
          {purchase.status === 'VOIDED' && (
            <Card style={styles.section}>
              <Text role="heading" style={styles.title}>
                Anulación
              </Text>
              {voidInfo.status === 'available' ? (
                <>
                  <Text style={styles.body}>Motivo: {voidInfo.reason}</Text>
                  <Text style={styles.body}>
                    Fecha de anulación: {purchaseDate(voidInfo.created_at, timezone)}
                  </Text>
                  <Text style={styles.body}>Anulada por un propietario</Text>
                  {voidInfo.stockCompensation.map((line) => (
                    <View key={line.purchase_item_id} style={styles.section}>
                      <Text style={styles.body}>
                        {items.find((i) => i.id === line.purchase_item_id)?.product_name_snapshot}
                      </Text>
                      <Text style={styles.body}>
                        Cantidad descontada del stock: {-line.quantity_delta}
                      </Text>
                    </View>
                  ))}
                </>
              ) : (
                <Text role="status" style={styles.body}>
                  Información de anulación no disponible
                </Text>
              )}
              <Text style={styles.secondary}>
                El costo de referencia actual del producto no se modifica por esta anulación.
              </Text>
            </Card>
          )}
        </View>
      </View>
    </View>
  );
}
function paymentLabel(value: string) {
  const labels: Record<string, string> = {
    CASH: 'Efectivo',
    BANK_TRANSFER: 'Transferencia bancaria',
    DEBIT_CARD: 'Tarjeta de débito',
    CREDIT_CARD: 'Tarjeta de crédito',
    DIGITAL_WALLET: 'Billetera digital',
  };
  return labels[value] ?? value;
}
