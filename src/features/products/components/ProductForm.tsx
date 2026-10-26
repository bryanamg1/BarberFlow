import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Badge, Button, Input, Modal } from '@/components/ui';
import { useCreateProduct } from '../hooks/useCreateProduct';
import { useUpdateProduct } from '../hooks/useUpdateProduct';
import { useProductLifecycle } from '../hooks/useProductLifecycle';
import { useProductCategoriesByIds } from '../hooks/useProductCategoriesByIds';
import { safeProductError } from '../utils/productErrors';
import type { ProductRow } from '../types/product.types';
import type { CreateProductInput } from '../schemas/product.schema';
import {
  productDirtyInput,
  productFormSchema,
  productFormValues,
  type ProductFormValues,
} from './productForm.schema';
import { ProductCategoryField } from './ProductCategoryField';
import { productStyles as styles } from './productPresentation';

const fields = [
  { name: 'name', label: 'Nombre (obligatorio)' },
  { name: 'description', label: 'Descripción' },
  { name: 'sku', label: 'SKU' },
  { name: 'sale_price', label: 'Precio de venta (obligatorio)' },
  { name: 'default_purchase_cost', label: 'Costo de compra de referencia (obligatorio)' },
  { name: 'minimum_stock', label: 'Stock mínimo' },
] as const;

export function ProductForm({
  product,
  currency,
  onSaved,
  onCancel,
  readBlocked = false,
}: {
  product?: ProductRow;
  currency: string;
  onSaved: (p: ProductRow) => void;
  onCancel: () => void;
  readBlocked?: boolean;
}) {
  // Both hooks are unconditional; exactly one approved write is invoked per intention.
  const create = useCreateProduct();
  const update = useUpdateProduct(product?.id ?? null);
  const mutation = product ? update : create;
  const lifetime = useProductLifecycle(
    JSON.stringify(['product-form', product?.id ?? 'new']),
    true,
  );
  const { control, handleSubmit, formState, reset, setFocus, setError } = useForm<
    ProductFormValues,
    unknown,
    CreateProductInput
  >({
    resolver: zodResolver(productFormSchema),
    defaultValues: productFormValues(product),
  });
  const selected = useWatch({ control, name: 'category_id' });
  const categories = useProductCategoriesByIds(selected ? [selected] : []);
  const category =
    categories.status === 'success'
      ? categories.data.find(
          (c) => c.id === selected && c.business_id === lifetime.scope?.businessId,
        )
      : undefined;
  const validCategory =
    selected == null ||
    (category !== undefined && (category.is_active || selected === product?.category_id));
  const flight = useRef(false);
  const [finished, setFinished] = useState(false);
  const [statusIntent, setStatusIntent] = useState<boolean | null>(null);
  const [error, setFailure] = useState<string | null>(null);
  const pending = formState.isSubmitting || mutation.status === 'pending';
  const blocked = pending || finished || statusIntent !== null || readBlocked;
  async function save() {
    if (flight.current || blocked || !lifetime.isCurrent()) return;
    flight.current = true;
    setFailure(null);
    mutation.reset();
    try {
      await handleSubmit(async (values) => {
        if (!lifetime.isCurrent()) return;
        if (!validCategory) {
          setError('category_id', {
            message: 'Selecciona una categoría activa del negocio o Sin categoría.',
          });
          return;
        }
        const saved = product
          ? await update.mutateAsync(productDirtyInput(values, formState.dirtyFields))
          : await create.mutateAsync(values);
        if (!lifetime.isCurrent()) return;
        setFinished(true);
        reset(productFormValues(saved));
        onSaved(saved);
      })();
    } catch (reason) {
      if (lifetime.isCurrent()) setFailure(safeProductError(reason).message);
    } finally {
      flight.current = false;
    }
  }
  async function changeStatus() {
    if (
      flight.current ||
      pending ||
      readBlocked ||
      statusIntent === null ||
      !product ||
      !lifetime.isCurrent()
    )
      return;
    flight.current = true;
    setFailure(null);
    update.reset();
    try {
      const saved = await update.mutateAsync({ is_active: statusIntent });
      if (!lifetime.isCurrent()) return;
      setFinished(true);
      onSaved(saved);
    } catch (reason) {
      if (lifetime.isCurrent()) setFailure(safeProductError(reason).message);
    } finally {
      flight.current = false;
    }
  }
  return (
    <View style={styles.section}>
      {fields.map((field, index) => (
        <Controller
          key={field.name}
          control={control}
          name={field.name}
          render={({ field: { value, onChange, onBlur, ref }, fieldState }) => {
            const money = field.name === 'sale_price' || field.name === 'default_purchase_cost';
            const integer = field.name === 'minimum_stock';
            return (
              <Input
                ref={ref}
                label={field.label}
                value={value ?? ''}
                onBlur={onBlur}
                error={fieldState.error?.message}
                disabled={blocked}
                onChangeText={(text) => {
                  if (blocked || flight.current) return;
                  setFailure(null);
                  onChange(text);
                }}
                multiline={field.name === 'description'}
                inputMode={money ? 'decimal' : integer ? 'numeric' : 'text'}
                keyboardType={money ? 'decimal-pad' : integer ? 'number-pad' : 'default'}
                autoCapitalize={money || integer || field.name === 'sku' ? 'none' : 'sentences'}
                helperText={
                  money ? `${currency} · Usa punto para decimales (ej. 10000.50).` : undefined
                }
                returnKeyType={index === fields.length - 1 ? 'done' : 'next'}
                onSubmitEditing={
                  field.name === 'description'
                    ? undefined
                    : () => {
                        if (blocked) return;
                        const next = fields[index + 1];
                        if (next) setFocus(next.name);
                        else void save();
                      }
                }
              />
            );
          }}
        />
      ))}
      <Controller
        control={control}
        name="category_id"
        render={({ field: { value, onChange }, fieldState }) => (
          <>
            <ProductCategoryField
              businessId={lifetime.scope?.businessId ?? ''}
              value={value}
              disabled={blocked}
              label={
                value == null
                  ? 'Sin categoría'
                  : category
                    ? `${category.name}${category.is_active ? '' : ' (archivada)'}`
                    : categories.status === 'pending'
                      ? 'Cargando categoría…'
                      : 'Categoría no disponible'
              }
              onChange={(id) => {
                if (!blocked && !flight.current) {
                  setFailure(null);
                  onChange(id);
                }
              }}
            />
            {fieldState.error && (
              <Text role="alert" style={styles.text}>
                {fieldState.error.message}
              </Text>
            )}
          </>
        )}
      />
      {categories.status === 'error' && (
        <Text role="alert" style={styles.text}>
          No se pudo verificar la categoría seleccionada.
        </Text>
      )}
      {product && (
        <>
          <Badge
            label={product.is_active ? 'Activo' : 'Archivado'}
            tone={product.is_active ? 'success' : 'neutral'}
          />
          <Button
            label={product.is_active ? 'Archivar producto' : 'Restaurar producto'}
            variant="outline"
            disabled={blocked}
            onPress={() => {
              if (!blocked && !flight.current) setStatusIntent(!product.is_active);
            }}
          />
        </>
      )}
      {error && (
        <Text role="alert" aria-live="assertive" style={styles.text}>
          {error}
        </Text>
      )}
      {pending && (
        <Text role="status" aria-live="polite" style={styles.text}>
          Guardando producto…
        </Text>
      )}
      <Button
        label={product ? 'Guardar cambios' : 'Crear producto'}
        loading={pending}
        disabled={
          readBlocked ||
          finished ||
          statusIntent !== null ||
          (Boolean(product) && !formState.isDirty)
        }
        onPress={() => void save()}
      />
      <Button
        label="Cancelar"
        variant="secondary"
        disabled={pending || finished || statusIntent !== null}
        onPress={() => {
          if (
            !pending &&
            !finished &&
            statusIntent === null &&
            !flight.current &&
            lifetime.isCurrent()
          )
            onCancel();
        }}
      />
      <Modal
        visible={statusIntent !== null}
        dismissible={!pending}
        closeLabel="Seguir editando"
        onClose={() => {
          if (!flight.current && !pending) setStatusIntent(null);
        }}
        title={statusIntent ? '¿Restaurar producto?' : '¿Archivar producto?'}
        description="Se actualizará únicamente el estado del catálogo. Los cambios sin guardar no se enviarán. El stock y el historial se conservan."
        actions={
          <>
            {error && (
              <Text role="alert" style={styles.text}>
                {error}
              </Text>
            )}
            <Button
              label={statusIntent ? 'Confirmar restauración' : 'Confirmar archivo'}
              disabled={finished || readBlocked}
              loading={pending}
              onPress={() => void changeStatus()}
            />
          </>
        }
      />
    </View>
  );
}
