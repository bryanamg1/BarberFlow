import { StyleSheet, Text, View } from 'react-native';

import { EmptyState, Input } from '@/components/ui';
import { theme } from '@/theme';

import { useCheckoutDiscount } from '../hooks/useCheckoutDiscount';

export function CheckoutDiscountField() {
  const model = useCheckoutDiscount();
  if (!model.draft) return <EmptyState title="Sin checkout activo" />;
  return (
    <View style={styles.section}>
      <Input
        label="Descuento global"
        value={model.value}
        inputMode="decimal"
        keyboardType="decimal-pad"
        disabled={model.locked}
        onChangeText={model.change}
        helperText="Importe absoluto con dos decimales. Reemplaza el descuento anterior."
        error={model.error}
      />
      {model.subtotal === null && (
        <Text role="status" style={styles.hint}>
          Subtotal no disponible. El descuento ingresado se conserva hasta poder validar el resumen.
        </Text>
      )}
      {model.locked && (
        <Text role="status" style={styles.hint}>
          No puedes editar el descuento mientras se resuelve la intención capturada.
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: theme.spacing[8] },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary },
});
