import { Badge } from '@/components/ui';
import type { ProductStockValue } from '../types/productStock.types';
import { productStockPresentation } from './productStockPresentation';

export function ProductStockBadge({
  stock,
  minimumStock,
}: {
  stock: ProductStockValue;
  minimumStock: number;
}) {
  const { label, tone } = productStockPresentation(stock, minimumStock);
  return (
    <Badge
      label={label}
      tone={tone}
      accessible
      role="status"
      aria-live="polite"
      accessibilityLabel={label}
      style={{ maxWidth: '100%' }}
      textStyle={{ flexShrink: 1 }}
    />
  );
}
