import { StyleSheet } from 'react-native';

import { theme } from '@/theme';

import type { CreateManualExpenseInput } from '../schemas/expense.schema';

export const expensePaymentLabels: Record<CreateManualExpenseInput['payment_method'], string> = {
  CASH: 'Efectivo',
  BANK_TRANSFER: 'Transferencia bancaria',
  DEBIT_CARD: 'Tarjeta de débito',
  CREDIT_CARD: 'Tarjeta de crédito',
  DIGITAL_WALLET: 'Billetera digital / QR',
};

export function expensePaymentLabel(code: string) {
  return Object.prototype.hasOwnProperty.call(expensePaymentLabels, code)
    ? expensePaymentLabels[code as keyof typeof expensePaymentLabels]
    : 'Medio de pago no disponible';
}

// Feature-local fluid layout; no new responsive dimensions or theme tokens.
export const expenseStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  fill: { flex: 1 },
  content: {
    width: '100%',
    alignSelf: 'center',
    padding: theme.spacing[16],
    gap: theme.spacing[24],
  },
  section: { gap: theme.spacing[16], minWidth: 0 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing[8] },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
  title: { ...theme.typography.headingSm, color: theme.colors.textPrimary, flexShrink: 1 },
  body: { ...theme.typography.body, color: theme.colors.textPrimary, flexShrink: 1 },
  hint: { ...theme.typography.body, color: theme.colors.textSecondary, flexShrink: 1 },
  error: { ...theme.typography.body, color: theme.colors.danger },
  success: { ...theme.typography.body, color: theme.colors.success },
});
