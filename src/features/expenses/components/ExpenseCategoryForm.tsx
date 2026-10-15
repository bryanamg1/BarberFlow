import { zodResolver } from '@hookform/resolvers/zod';
import { useLayoutEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { theme } from '@/theme';

import { useCreateExpenseCategory } from '../hooks/useCreateExpenseCategory';
import type { ExpenseCategoryRow } from '../repositories/expenseCategoriesRepository';
import type { CreateExpenseCategoryInput } from '../schemas/expenseCategory.schema';
import { ExpenseCategoryEditForm } from './ExpenseCategoryEditForm';
import { ExpenseCategoryFields } from './ExpenseCategoryFields';
import { createExpenseCategorySchema } from '../schemas/expenseCategory.schema';

export type ExpenseCategoryFormProps = {
  onCancel: () => void;
} & (
  | { mode?: 'create'; onSuccess: (expenseCategory: ExpenseCategoryRow) => void }
  | { mode: 'edit'; expenseCategoryId: string; initialExpenseCategory: ExpenseCategoryRow }
);

// Shared fields, with separate create and edit orchestration.
export function ExpenseCategoryForm(props: ExpenseCategoryFormProps) {
  return props.mode === 'edit' ? (
    <ExpenseCategoryEditForm {...props} />
  ) : (
    <CreateExpenseCategoryForm {...props} />
  );
}

function CreateExpenseCategoryForm({
  onSuccess,
  onCancel,
}: Extract<ExpenseCategoryFormProps, { mode?: 'create' }>) {
  const mutation = useCreateExpenseCategory();
  const { control, handleSubmit, formState } = useForm<CreateExpenseCategoryInput>({
    resolver: zodResolver(createExpenseCategorySchema),
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
        const input: CreateExpenseCategoryInput = {
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
      <ExpenseCategoryFields
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
