import { zodResolver } from '@hookform/resolvers/zod';
import { router, type Href } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Text, View } from 'react-native';

import { Button } from '@/components/ui';

import { useCreateManualExpense } from '../hooks/useCreateManualExpense';
import { useUpdateManualExpense } from '../hooks/useUpdateManualExpense';
import { useExpenseLifecycle } from '../hooks/useExpenseLifecycle';
import {
  createManualExpenseSchema,
  updateManualExpenseSchema,
  type CreateManualExpenseInput,
  type UpdateManualExpenseInput,
} from '../schemas/expense.schema';
import type { ExpenseRow } from '../types/expense.types';
import type { ExpenseMutationResult } from '../types/expenseHooks.types';
import { ManualExpenseFields } from './ManualExpenseFields';
import { expenseStyles as styles } from './expensePresentation';

type Props = { currency: string } & (
  { mode: 'create' } | { mode: 'edit'; initialExpense: ExpenseRow }
);

export function ManualExpenseForm(props: Props) {
  return props.mode === 'create' ? <CreateForm {...props} /> : <EditForm {...props} />;
}
function CreateForm(props: Extract<Props, { mode: 'create' }>) {
  const mutation = useCreateManualExpense();
  return (
    <FormBody
      {...props}
      mutation={{
        ...mutation,
        mutateAsync: (input) => mutation.mutateAsync(createManualExpenseSchema.parse(input)),
      }}
    />
  );
}
function EditForm(props: Extract<Props, { mode: 'edit' }>) {
  const mutation = useUpdateManualExpense(props.initialExpense.id);
  return <FormBody {...props} mutation={mutation} />;
}

function persistedValues(row: ExpenseRow) {
  const payment = createManualExpenseSchema.shape.payment_method.safeParse(row.payment_method);
  return {
    category_id: row.category_id,
    description: row.description,
    amount: String(row.amount),
    expense_date: row.expense_date,
    payment_method: payment.success ? payment.data : undefined,
    notes: row.notes,
    receipt_path: row.receipt_path,
  };
}
const editable = [
  'category_id',
  'description',
  'amount',
  'payment_method',
  'expense_date',
  'notes',
] as const;

function FormBody(props: Props & { mutation: ExpenseMutationResult<UpdateManualExpenseInput> }) {
  const { mutation, currency } = props;
  const initial = props.mode === 'edit' ? props.initialExpense : null;
  const lifetime = useExpenseLifecycle(`expense-form:${props.mode}:${initial?.id ?? ''}`);
  const { control, handleSubmit, reset, setFocus, formState } = useForm<CreateManualExpenseInput>({
    resolver: zodResolver(createManualExpenseSchema),
    // One initialization per mounted actor/business/resource. Refetch never resets a dirty draft.
    defaultValues: initial
      ? persistedValues(initial)
      : { category_id: '', description: '', amount: '', expense_date: '' },
  });
  const inFlight = useRef(false);
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState<ExpenseRow | null>(null);
  const navigated = useRef(false);
  const pending = sending || formState.isSubmitting || mutation.status === 'pending';
  const blocked = pending || (props.mode === 'create' && saved !== null);
  // Local in-flight protection only. This is not a new unsaved-changes navigation system.
  usePreventRemove(pending, () => {});
  useEffect(() => {
    if (
      props.mode === 'create' &&
      saved &&
      !pending &&
      lifetime.isCurrent() &&
      !navigated.current
    ) {
      navigated.current = true;
      router.replace(`/expenses/${encodeURIComponent(saved.id)}/edit` as Href);
    }
  }, [props.mode, saved, pending, lifetime]);

  async function submit(retry = false) {
    if (
      blocked ||
      inFlight.current ||
      !lifetime.isCurrent() ||
      (props.mode === 'edit' && !formState.isDirty && !retry)
    )
      return;
    inFlight.current = true;
    setSending(true);
    const isCurrent = lifetime.isCurrent;
    try {
      const adopt = (persisted: ExpenseRow) => {
        if (!isCurrent()) return;
        setSaved(persisted);
        if (props.mode === 'edit') reset(persistedValues(persisted));
      };
      if (retry) {
        adopt(await mutation.retry());
        return;
      }
      mutation.reset();
      await handleSubmit(async (values) => {
        if (!isCurrent()) return;
        const input: UpdateManualExpenseInput = {};
        for (const field of editable) {
          if (props.mode === 'create' || formState.dirtyFields[field]) {
            // Pick exact schema fields without exposing receipt paths as free-form inputs.
            Object.assign(input, { [field]: values[field] });
          }
        }
        if (props.mode === 'edit') updateManualExpenseSchema.parse(input);
        adopt(await mutation.mutateAsync(input));
      })();
    } catch {
      // BF232 owns safe domain feedback and preserves the captured retry intent.
    } finally {
      inFlight.current = false;
      if (isCurrent()) setSending(false);
    }
  }
  return (
    <View style={styles.section}>
      <ManualExpenseFields
        control={control}
        setFocus={setFocus}
        currency={currency}
        disabled={blocked}
        onSubmit={() => void submit()}
        onChange={() => {
          if (!inFlight.current && !blocked && lifetime.isCurrent()) {
            setSaved(null);
            mutation.reset();
          }
        }}
      />
      {mutation.status === 'error' && (
        <>
          <Text role="alert" aria-live="assertive" style={styles.error}>
            {mutation.error.message}
          </Text>
          <Button
            label="Reintentar guardado"
            variant="secondary"
            disabled={blocked}
            onPress={() => void submit(true)}
          />
        </>
      )}
      {pending && (
        <Text role="status" aria-live="polite" style={styles.hint}>
          Guardando gasto…
        </Text>
      )}
      {saved && props.mode === 'edit' && (
        <Text role="status" aria-live="polite" style={styles.success}>
          Gasto guardado correctamente.
        </Text>
      )}
      {mutation.refreshError && (
        <>
          <Text role="status" style={styles.hint}>
            El gasto se guardó, pero no se pudo actualizar la lectura.
          </Text>
          <Button
            label="Actualizar lectura"
            variant="secondary"
            disabled={pending}
            onPress={() => {
              void mutation.retryReads();
            }}
          />
        </>
      )}
      <Button
        label={props.mode === 'create' ? 'Crear gasto' : 'Guardar cambios'}
        loading={pending}
        disabled={blocked || (props.mode === 'edit' && !formState.isDirty)}
        onPress={() => void submit()}
      />
      <Button
        label="Cancelar"
        variant="secondary"
        disabled={blocked}
        onPress={() => {
          if (!inFlight.current && !blocked && lifetime.isCurrent())
            router.replace('/expenses' as Href);
        }}
      />
    </View>
  );
}
