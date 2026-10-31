import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Badge } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { formatCatalogPrice } from '@/utils/formatMoney';
import type { SaleRow } from '../types/checkout.types';
import { saleDate, saleStatuses, saleStyles as styles } from './salePresentation';

export function SaleHistoryRow({ sale, onPress }: { sale: SaleRow; onPress: () => void }) {
  const business = useBusiness(),
    [focused, setFocused] = useState(false);
  if (business.status !== 'success') return null;
  const date = saleDate(sale.sold_at ?? sale.created_at, business.data.business.timezone);
  const total = formatCatalogPrice(sale.total, business.data.business.currency_code);
  return (
    <Pressable
      role="button"
      accessibilityLabel={`Ver venta: ${date}, ${total}, ${saleStatuses[sale.status]}`}
      accessibilityHint="Abre el detalle de la venta"
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, focused && styles.focused]}
    >
      <Text style={styles.text}>{date}</Text>
      <Text style={styles.text}>{total}</Text>
      <Badge label={saleStatuses[sale.status]} />
    </Pressable>
  );
}
