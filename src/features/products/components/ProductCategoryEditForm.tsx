import { zodResolver } from '@hookform/resolvers/zod';
import { useLayoutEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Modal } from '@/components/ui';
import { theme } from '@/theme';

import { useUpdateProductCategory } from '../hooks/useUpdateProductCategory';
import type { ProductCategoryRow } from '../repositories/productCategoriesRepository';
import {
  createProductCategorySchema,
  type CreateProductCategoryInput,
  updateProductCategorySchema,
  type UpdateProductCategoryInput,
} from '../schemas/productCategory.schema';
import { ProductCategoryFields } from './ProductCategoryFields';
import type { ProductCategoryFormProps } from './ProductCategoryForm';

function formValues(productCategory: ProductCategoryRow): CreateProductCategoryInput {
  return {
    name: productCategory.name,
  };
}

export function ProductCategoryEditForm({
  productCategoryId,
  initialProductCategory,
  onCancel,
}: Extract<ProductCategoryFormProps, { mode: 'edit' }>) {
  const mutation = useUpdateProductCategory();
  const { control, handleSubmit, reset, formState } = useForm<CreateProductCategoryInput>({
    resolver: zodResolver(createProductCategorySchema),
    // Captured once per business/route identity; ordinary detail refetch never resets a draft.
    defaultValues: formValues(initialProductCategory),
  });
  const { dirtyFields, isDirty, isSubmitting } = formState;
  const [confirmation, setConfirmation] = useState<boolean | null>(null);
  // Returned persisted status bridges an awaited write and the next actual detail snapshot.
  const [savedStatus, setSavedStatus] = useState<{
    source: ProductCategoryRow;
    active: boolean;
  } | null>(null);
  const active =
    savedStatus?.source === initialProductCategory
      ? savedStatus.active
      : initialProductCategory.is_active;
  const inFlight = useRef(false);
  const detailSource = useRef(initialProductCategory);
  const lifetime = useRef<symbol | null>(null);
  const pending = isSubmitting || mutation.status === 'pending';
  const blocked = pending || confirmation !== null;

  useLayoutEffect(() => {
    detailSource.current = initialProductCategory;
  }, [initialProductCategory]);

  useLayoutEffect(() => {
    lifetime.current = Symbol();
    return () => {
      lifetime.current = null;
    };
  }, []);

  async function perform(
    input: UpdateProductCategoryInput,
    statusOnly: boolean,
    operation: symbol,
  ) {
    const persisted = await mutation.mutateAsync({ productCategoryId, input });
    if (lifetime.current !== operation) return;
    // A status operation never submits or discards unsaved fields. All defaults come from the server.
    reset(formValues(persisted), statusOnly ? { keepDirtyValues: true } : undefined);
    setSavedStatus({ source: detailSource.current, active: persisted.is_active });
    setConfirmation(null);
    mutation.reset();
  }

  async function save() {
    if (!isDirty || blocked || inFlight.current || lifetime.current === null) return;
    const operation = lifetime.current;
    inFlight.current = true;
    mutation.reset();
    try {
      await handleSubmit(async (values) => {
        if (lifetime.current !== operation) return;
        const input: UpdateProductCategoryInput = {};
        if (dirtyFields.name) input.name = values.name;
        if (Object.keys(input).length === 0) return;
        await perform(updateProductCategorySchema.parse(input), false, operation);
      })();
    } catch {
      // The hook owns normalized errors. Keep draft and current persisted status on rejection.
    } finally {
      inFlight.current = false;
    }
  }

  async function changeStatus() {
    if (confirmation === null || pending || inFlight.current || lifetime.current === null) return;
    const operation = lifetime.current;
    inFlight.current = true;
    mutation.reset();
    try {
      await perform(
        updateProductCategorySchema.parse({ is_active: confirmation }),
        true,
        operation,
      );
    } catch {
      // The confirmation stays open for a controlled retry; no optimistic status change.
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <View style={styles.form}>
      <ProductCategoryFields
        control={control}
        disabled={blocked}
        onChange={() => {
          if (mutation.status === 'error') mutation.reset();
        }}
        onSubmit={() => void save()}
      />
      <Badge label={active ? 'Activa' : 'Archivada'} tone={active ? 'success' : 'neutral'} />
      <Button
        label={active ? 'Archivar categoría' : 'Restaurar categoría'}
        variant="outline"
        disabled={blocked}
        onPress={() => {
          if (!inFlight.current && !blocked) setConfirmation(!active);
        }}
      />
      {confirmation === null && mutation.status === 'error' && (
        <Text role="alert" aria-live="assertive" style={styles.error}>
          {mutation.error.message}
        </Text>
      )}
      {pending && (
        <Text role="status" aria-live="polite" style={styles.status}>
          Guardando categoría…
        </Text>
      )}
      <Button
        label="Guardar cambios"
        disabled={!isDirty || blocked}
        loading={pending}
        onPress={() => void save()}
      />
      <Button
        label="Cancelar"
        variant="secondary"
        disabled={blocked}
        onPress={() => {
          if (blocked || inFlight.current) return;
          lifetime.current = null;
          onCancel();
        }}
      />
      <Modal
        visible={confirmation !== null}
        dismissible={!pending}
        closeLabel="Seguir editando"
        onClose={() => {
          if (!inFlight.current && !pending) setConfirmation(null);
        }}
        title={confirmation ? '¿Restaurar categoría?' : '¿Archivar categoría?'}
        description={
          confirmation
            ? 'La categoría volverá a estar activa.'
            : 'La categoría quedará archivada. Los productos conservarán su categoría y podrás reactivarla.'
        }
        actions={
          <>
            {mutation.status === 'error' && (
              <Text role="alert" aria-live="assertive" style={styles.error}>
                {mutation.error.message}
              </Text>
            )}
            {pending && (
              <Text role="status" aria-live="polite" style={styles.status}>
                Guardando categoría…
              </Text>
            )}
            <Button
              label={confirmation ? 'Confirmar restauración' : 'Confirmar archivo'}
              loading={pending}
              onPress={() => void changeStatus()}
            />
          </>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: theme.spacing[16] },
  error: { ...theme.typography.body, color: theme.colors.danger },
  status: { ...theme.typography.body, color: theme.colors.textSecondary },
});
