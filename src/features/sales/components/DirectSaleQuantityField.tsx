import { Input } from '@/components/ui';

import type { CheckoutProductQuantityProps } from './CheckoutProductItems';

// Text, validation and the lineId-bound callback come from BF192, not local state.
export function DirectSaleQuantityField(props: CheckoutProductQuantityProps) {
  return (
    <Input
      {...props}
      inputMode="numeric"
      keyboardType="number-pad"
      selectTextOnFocus
      accessibilityHint="Edita la cantidad de esta línea. Las otras líneas del mismo producto se conservan."
      helperText="Cantidad por línea. El stock se compara con la suma de todas las líneas del producto."
    />
  );
}
