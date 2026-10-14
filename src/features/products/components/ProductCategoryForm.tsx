import { zodResolver } from '@hookform/resolvers/zod';
import { useLayoutEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { theme } from '@/theme';

import { useCreateProductCategory } from '../hooks/useCreateProductCategory';
import type { ProductCategoryRow } from '../repositories/productCategoriesRepository';
import type { CreateProductCategoryInput } from '../schemas/productCategory.schema';
import { ProductCategoryEditForm } from './ProductCategoryEditForm';
import { ProductCategoryFields } from './ProductCategoryFields';
import { createProductCategorySchema } from '../schemas/productCategory.schema';

export type ProductCategoryFormProps = {
  onCancel: () => void;
} & (
  | { mode?: 'create'; onSuccess: (productCategory: ProductCategoryRow) => void }
  | { mode: 'edit'; productCategoryId: string; initialProductCategory: ProductCategoryRow }
);

// Shared fields, with separate create and edit orchestration.
export function ProductCategoryForm(props: ProductCategoryFormProps) {
  return props.mode === 'edit' ? (
    <ProductCategoryEditForm {...props} />
  ) : (
    <CreateProductCategoryForm {...props} />
  );
}

function CreateProductCategoryForm({
  onSuccess,
  onCancel,
}: Extract<ProductCategoryFormProps, { mode?: 'create' }>) {
  const mutation = useCreateProductCategory();
  const { control, handleSubmit, formState } = useForm<CreateProductCategoryInput>({
    resolver: zodResolver(createProductCategorySchema),
    defaultValues: { name: '' },
  });
  const inFlight = useRef(false);
  const lifetime = useRef<symbol | null>(null);
  const pending = formState.isSubmitting || mutation.status === 'pending';
  const blocked = pending || mutation.status === 'success';

  useLayoutEffect(() => {
    lifetime.current = Symbol();
    return () => {
      lifetime.current = null;
    };
  }, []);

  async function submit() {
    if (inFlight.current || blocked || lifetime.current === null) return;
    inFlight.current = true;
    const operationLifetime = lifetime.current;
    const isCurrent = () => lifetime.current === operationLifetime;
    let succeeded = false;
    mutation.reset();
    try {
      await handleSubmit(async (values) => {
        if (!isCurrent()) return;
        const input: CreateProductCategoryInput = {
          name: values.name,
        };
        const created = await mutation.mutateAsync(input);
        succeeded = true;
        if (isCurrent()) onSuccess(created);
      })();
    } catch {
      // Hook owns the safe error. A rejected operation never changes navigation or draft values.
    } finally {
      if (!succeeded) inFlight.current = false;
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
        onSubmit={() => void submit()}
      />
      {mutation.status === 'error' && (
        <Text role="alert" aria-live="assertive" style={styles.error}>
          {mutation.error.message}
        </Text>
      )}
      {pending && (
        <Text role="status" aria-live="polite" style={styles.status}>
          Creando categoría…
        </Text>
      )}
      <Button
        label="Crear categoría"
        loading={pending}
        disabled={mutation.status === 'success'}
        onPress={() => void submit()}
      />
      <Button
        label="Cancelar"
        variant="secondary"
        disabled={blocked}
        onPress={() => {
          if (inFlight.current || blocked) return;
          lifetime.current = null;
          onCancel();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: theme.spacing[16] },
  error: { ...theme.typography.body, color: theme.colors.danger },
  status: { ...theme.typography.body, color: theme.colors.textSecondary },
});
