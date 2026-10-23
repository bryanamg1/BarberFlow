import { StyleSheet, Text, View } from 'react-native';

import { Button, EmptyState } from '@/components/ui';
import { theme } from '@/theme';

import { useCheckoutPayment } from '../hooks/useCheckoutPayment';
import type { CheckoutPaymentMethod } from '../store/checkoutDraftStore';

const labels: Record<CheckoutPaymentMethod, string> = {
  CASH: 'Efectivo',
  BANK_TRANSFER: 'Transferencia bancaria',
  DEBIT_CARD: 'Tarjeta de débito',
  CREDIT_CARD: 'Tarjeta de crédito',
  DIGITAL_WALLET: 'Billetera digital',
};

export function CheckoutPaymentField() {
  const model = useCheckoutPayment();
  if (!model.draft) return <EmptyState title="Sin checkout activo" />;
  return (
    <View style={styles.section}>
      <Text role="heading" style={styles.heading}>
        Método de pago
      </Text>
      <View style={styles.options}>
        {model.methods.map((method) => (
          <Button
            key={method}
            label={labels[method]}
            accessibilityLabel={`Método de pago: ${labels[method]}`}
            accessibilityState={{ selected: model.method === method }}
            variant={model.method === method ? 'primary' : 'outline'}
            disabled={model.locked}
            onPress={() => {
              model.select(method);
            }}
          />
        ))}
      </View>
      <Text role="status" aria-live="polite" style={styles.hint}>
        {model.method
          ? `Método seleccionado: ${labels[model.method]}`
          : 'Selecciona un método de pago para continuar.'}
      </Text>
      {model.zeroTotal && <Text style={styles.hint}>No se registrará un cobro.</Text>}
      {!model.summaryEligible && (
        <Text style={styles.hint}>
          Revisa el resumen antes de continuar. La selección se conserva.
        </Text>
      )}
      {model.locked && (
        <Text role="status" style={styles.hint}>
          No puedes cambiar el método mientras se resuelve la intención capturada.
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: theme.spacing[8] },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[8] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary },
});
