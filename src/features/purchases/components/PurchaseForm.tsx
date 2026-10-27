import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, Input, LoadingState } from '@/components/ui';
import { useProductList } from '@/features/products/hooks/useProductList';
import { useExpenseCategoryList } from '@/features/expenses/hooks/useExpenseCategoryList';
import { useExpenseCategoryDetail } from '@/features/expenses/hooks/useExpenseCategoryDetail';
import { expenseCategoriesKeys } from '@/features/expenses/constants/expenseCategoriesKeys';
import { expensePaymentLabels } from '@/features/expenses/components/expensePresentation';
import { formatMoney } from '@/utils/formatMoney';
import { completePurchaseSchema, type CompletePurchaseInput } from '../schemas/purchase.schema';
import { purchaseDraftStore, type PurchaseDraft } from '../store/purchaseDraftStore';
import { PurchaseProductLine } from './PurchaseProductLine';
import { purchaseEstimate } from '../utils/purchaseFormValues';
import { purchaseStyles as styles } from './purchasePresentation';

export function PurchaseForm({
  draft,
  businessId,
  currency,
  timezone,
  locked,
  pending,
  onSubmit,
  onCancel,
}: {
  draft: PurchaseDraft;
  businessId: string;
  currency: string;
  timezone: string;
  locked: boolean;
  pending: boolean;
  onSubmit: (input: CompletePurchaseInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { control, handleSubmit, getValues, formState } = useForm<CompletePurchaseInput>({
    resolver: zodResolver(completePurchaseSchema),
    defaultValues: draft,
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = useWatch({ control, name: 'items' }) ?? [];
  const selected = useWatch({ control, name: 'expenseCategoryId' });
  const category = useExpenseCategoryDetail(selected ?? null);
  const [productPage, setProductPage] = useState(1),
    [categoryPage, setCategoryPage] = useState(1);
  const products = useProductList({ page: productPage, pageSize: 25, status: 'active' });
  const params = { page: categoryPage, pageSize: 25, status: 'active' as const };
  const categories = useExpenseCategoryList(params),
    client = useQueryClient();
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const references = useRef(new Map<string, { productId: string; valid: boolean }>());
  const onValidity = useCallback((id: string, productId: string, valid: boolean | null) => {
    if (valid === null) references.current.delete(id);
    else references.current.set(id, { productId, valid });
  }, []);
  const flight = useRef(false),
    disabled = locked || formState.isSubmitting;
  function mirror() {
    purchaseDraftStore.getState().patchDraft(businessId, draft.operationId, getValues());
  }
  async function submit() {
    if (disabled || flight.current) return;
    flight.current = true;
    setReferenceError(null);
    try {
      await handleSubmit(async (input) => {
        const current = purchaseDraftStore.getState();
        if (current.businessId !== businessId || current.draft?.operationId !== draft.operationId)
          return;
        if (
          category.status !== 'success' ||
          category.data.id !== input.expenseCategoryId ||
          category.data.business_id !== businessId ||
          !category.data.is_active ||
          fields.some(
            (f, i) =>
              references.current.get(f.id)?.productId !== input.items[i]?.productId ||
              !references.current.get(f.id)?.valid,
          )
        ) {
          setReferenceError('Revisa los productos y selecciona una categoría activa del negocio.');
          return;
        }
        await onSubmit(input);
      })();
    } finally {
      flight.current = false;
    }
  }
  const total = purchaseEstimate(items);
  const itemError = formState.errors.items?.message ?? formState.errors.items?.root?.message;
  return (
    <View style={styles.section}>
      {(
        [
          { name: 'supplierName', label: 'Proveedor (obligatorio)' },
          { name: 'purchasedAt', label: 'Fecha y hora de compra (ISO con zona)' },
          { name: 'notes', label: 'Notas' },
        ] as const
      ).map((spec) => (
        <Controller
          key={spec.name}
          control={control}
          name={spec.name}
          render={({ field, fieldState }) => (
            <Input
              ref={field.ref}
              label={spec.label}
              value={field.value ?? ''}
              multiline={spec.name === 'notes'}
              disabled={disabled}
              error={fieldState.error?.message}
              onBlur={field.onBlur}
              helperText={
                spec.name === 'purchasedAt'
                  ? `Instante explícito con Z u offset. Zona del negocio: ${timezone}. Sin usar la hora del dispositivo.`
                  : undefined
              }
              onChangeText={(text) => {
                if (!disabled && !flight.current) {
                  field.onChange(text);
                  mirror();
                }
              }}
            />
          )}
        />
      ))}
      <Controller
        control={control}
        name="paymentMethod"
        render={({ field, fieldState }) => (
          <View style={styles.section}>
            <Text style={styles.title}>Método de pago</Text>
            <View style={styles.controls}>
              {completePurchaseSchema.shape.paymentMethod.options.map((method) => (
                <Button
                  key={method}
                  label={`Método: ${expensePaymentLabels[method]}`}
                  variant={field.value === method ? 'primary' : 'outline'}
                  accessibilityState={{ selected: field.value === method }}
                  disabled={disabled}
                  onPress={() => {
                    if (!disabled && !flight.current) {
                      field.onChange(method);
                      mirror();
                    }
                  }}
                />
              ))}
            </View>
            {fieldState.error && (
              <Text role="alert" style={styles.body}>
                {fieldState.error.message}
              </Text>
            )}
          </View>
        )}
      />
      <Controller
        control={control}
        name="expenseCategoryId"
        render={({ field, fieldState }) => (
          <View style={styles.section}>
            <Text style={styles.title}>
              Categoría de gasto:{' '}
              {category.status === 'success' && category.data.business_id === businessId
                ? `${category.data.name}${category.data.is_active ? '' : ' (archivada; cambia la selección)'}`
                : selected
                  ? 'No disponible'
                  : 'Sin seleccionar'}
            </Text>
            {categories.status === 'pending' ? (
              <LoadingState message="Cargando categorías…" />
            ) : categories.status === 'error' ? (
              <ErrorState
                message="No se pudieron cargar las categorías."
                onRetry={() => {
                  void client.invalidateQueries({
                    queryKey: expenseCategoriesKeys.list(businessId, params),
                    exact: true,
                  });
                }}
              />
            ) : categories.status === 'success' ? (
              <>
                {categories.data.items
                  .filter((c) => c.business_id === businessId && c.is_active)
                  .map((c) => (
                    <Button
                      key={c.id}
                      label={`Categoría de gasto: ${c.name}`}
                      disabled={disabled}
                      accessibilityState={{ selected: field.value === c.id }}
                      variant={field.value === c.id ? 'primary' : 'outline'}
                      onPress={() => {
                        if (!disabled && !flight.current) {
                          field.onChange(c.id);
                          mirror();
                        }
                      }}
                    />
                  ))}
                {categories.data.items.length === 0 && (
                  <Text style={styles.body}>No hay categorías activas en esta página.</Text>
                )}
                <View style={styles.controls}>
                  <Button
                    label="Categorías anteriores"
                    disabled={disabled || categoryPage === 1}
                    onPress={() => setCategoryPage((p) => p - 1)}
                  />
                  <Button
                    label="Más categorías de gastos"
                    disabled={disabled || !categories.data.hasNextPage}
                    onPress={() => setCategoryPage((p) => p + 1)}
                  />
                </View>
              </>
            ) : null}
            {fieldState.error && (
              <Text role="alert" style={styles.body}>
                {fieldState.error.message}
              </Text>
            )}
            {category.status === 'error' && (
              <ErrorState
                message="No se pudo verificar la categoría seleccionada."
                onRetry={() => {
                  void client.invalidateQueries({
                    queryKey: expenseCategoriesKeys.detail(businessId, selected),
                    exact: true,
                  });
                }}
              />
            )}
          </View>
        )}
      />
      <Text role="heading" style={styles.title}>
        Productos de la compra
      </Text>
      {fields.map((f, index) => (
        <PurchaseProductLine
          key={f.id}
          control={control}
          index={index}
          lineId={f.id}
          productId={f.productId}
          businessId={businessId}
          locked={disabled}
          onPatch={mirror}
          canEdit={() => !disabled && !flight.current}
          onValidity={onValidity}
          onRemove={() => {
            if (!disabled && !flight.current) {
              remove(index);
              mirror();
            }
          }}
        />
      ))}
      {itemError && (
        <Text role="alert" style={styles.body}>
          {itemError}
        </Text>
      )}
      {products.status === 'pending' ? (
        <LoadingState message="Cargando productos…" />
      ) : products.status === 'error' ? (
        <ErrorState message={products.error.message} onRetry={() => void products.refetch()} />
      ) : products.status === 'success' ? (
        <>
          {products.data.items
            .filter((p) => p.business_id === businessId && p.is_active)
            .map((p) => (
              <Button
                key={p.id}
                label={`Agregar producto: ${p.name}`}
                disabled={disabled}
                onPress={() => {
                  if (!disabled && !flight.current) {
                    append({ productId: p.id, quantity: 1, unitCost: '' });
                    mirror();
                  }
                }}
              />
            ))}
          {products.data.items.length === 0 && (
            <Text style={styles.body}>No hay productos activos en esta página.</Text>
          )}
          <View style={styles.controls}>
            <Button
              label="Productos anteriores"
              disabled={disabled || productPage === 1}
              onPress={() => setProductPage((p) => p - 1)}
            />
            <Button
              label="Más productos"
              disabled={disabled || !products.data.hasNextPage}
              onPress={() => setProductPage((p) => p + 1)}
            />
          </View>
        </>
      ) : null}
      <Text role="status" style={styles.body}>
        {total === null
          ? 'Total estimado no disponible'
          : `Total estimado: ${formatMoney(total, currency)}`}
      </Text>
      <Text style={styles.secondary}>
        Al registrar la compra se confirman juntos el total, el stock y el gasto correspondiente.
      </Text>
      {referenceError && (
        <Text role="alert" style={styles.body}>
          {referenceError}
        </Text>
      )}
      <Button
        label="Registrar compra"
        disabled={locked}
        loading={formState.isSubmitting || pending}
        onPress={() => void submit()}
      />
      <Button
        label="Cancelar compra"
        variant="secondary"
        disabled={disabled}
        onPress={() => {
          if (!disabled && !flight.current) onCancel();
        }}
      />
    </View>
  );
}
