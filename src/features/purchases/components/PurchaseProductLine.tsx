import { useLayoutEffect } from 'react';
import { Controller, type Control } from 'react-hook-form';
import { Text, View } from 'react-native';
import { Button, Input } from '@/components/ui';
import { useProductDetail } from '@/features/products/hooks/useProductDetail';
import type { CompletePurchaseInput } from '../schemas/purchase.schema';
import { purchaseQuantityText } from '../utils/purchaseFormValues';
import { purchaseStyles as styles } from './purchasePresentation';

export function PurchaseProductLine({
  control,
  index,
  lineId,
  productId,
  businessId,
  locked,
  onPatch,
  canEdit,
  onRemove,
  onValidity,
}: {
  control: Control<CompletePurchaseInput>;
  index: number;
  lineId: string;
  productId: string;
  businessId: string;
  locked: boolean;
  onPatch: () => void;
  canEdit: () => boolean;
  onRemove: () => void;
  onValidity: (lineId: string, productId: string, valid: boolean | null) => void;
}) {
  const product = useProductDetail(productId);
  const valid =
    product.status === 'success' &&
    product.data.id === productId &&
    product.data.business_id === businessId &&
    product.data.is_active;
  useLayoutEffect(() => {
    onValidity(lineId, productId, valid);
    return () => onValidity(lineId, productId, null);
  }, [lineId, productId, valid, onValidity]);
  return (
    <View style={styles.row}>
      <Text style={styles.title}>
        {valid && product.status === 'success' ? product.data.name : 'Producto no disponible'}
      </Text>
      {!valid && (
        <Text role="alert" style={styles.body}>
          {product.status === 'pending'
            ? 'Cargando producto…'
            : 'La referencia no está disponible. Quita esta línea y selecciona un producto activo.'}
        </Text>
      )}
      {product.status === 'error' && (
        <Button
          label={`Reintentar producto de línea ${index + 1}`}
          disabled={locked}
          onPress={() => void product.refetch()}
        />
      )}
      <Controller
        control={control}
        name={`items.${index}.quantity`}
        render={({ field, fieldState }) => (
          <Input
            ref={field.ref}
            label={`Cantidad de línea ${index + 1}`}
            value={Number.isFinite(field.value) ? String(field.value) : ''}
            inputMode="numeric"
            keyboardType="number-pad"
            disabled={locked}
            error={fieldState.error?.message}
            onBlur={field.onBlur}
            onChangeText={(text) => {
              if (!locked && canEdit()) {
                field.onChange(purchaseQuantityText(text));
                onPatch();
              }
            }}
          />
        )}
      />
      <Controller
        control={control}
        name={`items.${index}.unitCost`}
        render={({ field, fieldState }) => (
          <Input
            ref={field.ref}
            label={`Costo unitario de línea ${index + 1}`}
            value={field.value ?? ''}
            inputMode="decimal"
            keyboardType="decimal-pad"
            helperText="Usa punto y dos decimales (ej. 6500.00)."
            disabled={locked}
            error={fieldState.error?.message}
            onBlur={field.onBlur}
            onChangeText={(text) => {
              if (!locked && canEdit()) {
                field.onChange(text);
                onPatch();
              }
            }}
          />
        )}
      />
      <Button
        label={`Quitar línea ${index + 1}`}
        variant="outline"
        disabled={locked}
        onPress={onRemove}
      />
    </View>
  );
}
