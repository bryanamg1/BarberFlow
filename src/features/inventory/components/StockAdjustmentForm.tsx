import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuid } from 'expo-modules-core';
import { useLayoutEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card, ErrorState, Input, LoadingState, Modal } from '@/components/ui';
import { theme } from '@/theme';
import { inventoryKeys } from '../constants/inventoryKeys';
import type { AdjustStockInput } from '../schemas/stockAdjustment.schema';
import { inventoryService } from '../services/inventoryService';
import { adjustmentError } from '../services/stockAdjustmentErrors';
import type { StockMovementRow } from '../types/inventory.types';
import type { AdjustStockError } from '../types/stockAdjustment.types';
import {
  stockAdjustmentFormSchema,
  type StockAdjustmentFormValues,
} from './stockAdjustmentForm.schema';

export type StockAdjustmentFormProps = {
  businessId: string;
  productId: string;
  onCancel: () => void;
};
const signed = (quantity: number) => (quantity > 0 ? `+${quantity}` : String(quantity));

// The screen keys this form by actor/membership/business/product. A new scope owns a new draft.
export function StockAdjustmentForm({ businessId, productId, onCancel }: StockAdjustmentFormProps) {
  const [operationId] = useState(() => uuid.v4());
  const { control, handleSubmit, setValue, reset, formState } = useForm<
    StockAdjustmentFormValues,
    unknown,
    AdjustStockInput
  >({
    resolver: zodResolver(stockAdjustmentFormSchema),
    defaultValues: { operationId, productId, quantityDelta: '', reason: 'ADJUSTMENT' },
  });
  const client = useQueryClient();
  const stock = useQuery<string, AdjustStockError>({
    queryKey: inventoryKeys.productStock(businessId, productId),
    retry: false,
    queryFn: async () => {
      const result = await inventoryService.getProductStock(businessId, [productId]);
      if (result.error) throw result.error;
      const row = result.data.find(
        (item) => item.product_id.toLowerCase() === productId.toLowerCase(),
      );
      if (!row) throw adjustmentError('NOT_FOUND');
      return row.current_stock;
    },
  });
  const mutation = useMutation<StockMovementRow, AdjustStockError, AdjustStockInput>({
    retry: false,
    mutationFn: async (input) => {
      const result = await inventoryService.adjustStock(businessId, input);
      if (result.error) throw result.error;
      return result.data;
    },
    // Includes this product's stock and existing history. No Home/product stock consumer exists yet.
    onSuccess: () => client.invalidateQueries({ queryKey: inventoryKeys.byBusiness(businessId) }),
  });
  const [attempt, setAttempt] = useState<AdjustStockInput | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<AdjustStockError | null>(null);
  const [saved, setSaved] = useState<StockMovementRow | null>(null);
  const preparing = useRef(false);
  const sending = useRef(false);
  const lifetime = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    lifetime.current = Symbol();
    return () => {
      lifetime.current = null;
    };
  }, []);
  const pending = formState.isSubmitting || mutation.isPending;
  const locked = attempt !== null || pending;

  async function prepare() {
    if (preparing.current || locked || !stock.isSuccess || lifetime.current === null) return;
    preparing.current = true;
    const captured = lifetime.current;
    try {
      await handleSubmit((input) => {
        if (lifetime.current !== captured) return;
        setAttempt(Object.freeze({ ...input }));
        setFailure(null);
        setConfirming(true);
      })();
    } finally {
      preparing.current = false;
    }
  }
  async function send() {
    if (sending.current || !attempt || saved || lifetime.current === null) return;
    sending.current = true;
    const captured = lifetime.current;
    const input = attempt;
    setFailure(null);
    try {
      const movement = await mutation.mutateAsync(input);
      if (lifetime.current !== captured) return;
      setSaved(movement);
      setConfirming(false);
    } catch (error) {
      if (lifetime.current !== captured) return;
      // Service errors are safe; unexpected callback failures never reach the UI verbatim.
      setFailure(
        error &&
          typeof error === 'object' &&
          'code' in error &&
          [
            'INVALID_INPUT',
            'INVENTORY_ACCESS_DENIED',
            'NOT_FOUND',
            'INSUFFICIENT_STOCK',
            'NETWORK_ERROR',
            'UNKNOWN_ERROR',
          ].includes(String(error.code))
          ? adjustmentError(error.code as AdjustStockError['code'])
          : adjustmentError('UNKNOWN_ERROR'),
      );
    } finally {
      sending.current = false;
    }
  }
  function newIntent() {
    if (sending.current) return;
    const nextId = uuid.v4();
    reset({ operationId: nextId, productId, quantityDelta: '', reason: 'ADJUSTMENT' });
    setAttempt(null);
    setSaved(null);
    setFailure(null);
    setConfirming(false);
    mutation.reset();
  }
  const canReplace =
    failure && ['INVALID_INPUT', 'INSUFFICIENT_STOCK', 'NOT_FOUND'].includes(failure.code);
  return (
    <View style={styles.section}>
      <Card>
        {stock.isError ? (
          <ErrorState
            message={stock.error.message}
            onRetry={() => {
              void stock.refetch();
            }}
            retrying={stock.isFetching}
          />
        ) : stock.isSuccess ? (
          <Text role="status" style={styles.heading}>
            Saldo actual: {stock.data}
          </Text>
        ) : (
          <LoadingState message="Consultando saldo…" />
        )}
      </Card>
      {saved ? (
        <View style={styles.section}>
          <Text role="status" aria-live="polite" style={styles.heading}>
            Ajuste registrado: {signed(saved.quantity_delta)} unidades.
          </Text>
          <Button label="Nuevo ajuste" onPress={newIntent} />
        </View>
      ) : (
        <>
          <Text style={styles.label}>Motivo</Text>
          <Controller
            control={control}
            name="reason"
            render={({ field }) => (
              <View style={styles.controls}>
                {(['ADJUSTMENT', 'LOSS'] as const).map((reason) => (
                  <Button
                    key={reason}
                    label={reason === 'LOSS' ? 'Pérdida' : 'Ajuste'}
                    variant={field.value === reason ? 'primary' : 'secondary'}
                    accessibilityState={{ selected: field.value === reason }}
                    disabled={locked}
                    onPress={() => field.onChange(reason)}
                  />
                ))}
              </View>
            )}
          />
          <Controller
            control={control}
            name="quantityDelta"
            render={({ field, fieldState }) => (
              <Input
                label="Cantidad del ajuste"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                error={fieldState.error?.message}
                helperText="Usa un entero con signo: -2 para quitar, +3 para agregar."
                keyboardType="numbers-and-punctuation"
                disabled={locked}
              />
            )}
          />
          <Controller
            control={control}
            name="notes"
            render={({ field, fieldState }) => (
              <Input
                label="Notas (opcional)"
                value={field.value ?? ''}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                error={fieldState.error?.message}
                multiline
                disabled={locked}
              />
            )}
          />
          {failure && (
            <Text role="alert" style={styles.error}>
              {failure.message}
            </Text>
          )}
          {attempt ? (
            <>
              <Text style={styles.body}>
                La intención está conservada. Reintentar verifica el mismo ajuste sin duplicarlo.
              </Text>
              <Button
                label="Reintentar ajuste"
                disabled={pending}
                onPress={() => setConfirming(true)}
              />
              {canReplace && (
                <Button
                  label="Modificar ajuste"
                  variant="secondary"
                  disabled={pending}
                  onPress={newIntent}
                />
              )}
            </>
          ) : (
            <Button
              label="Revisar ajuste"
              loading={pending}
              disabled={!stock.isSuccess || pending}
              onPress={() => {
                void prepare();
              }}
            />
          )}
        </>
      )}
      <Button
        label="Volver a Productos"
        variant="secondary"
        disabled={pending}
        onPress={onCancel}
      />
      <Modal
        visible={confirming}
        title="Confirmar ajuste de stock"
        dismissible={!pending}
        onClose={() => {
          if (sending.current) return;
          setConfirming(false);
          if (!failure) {
            setAttempt(null);
            setValue('operationId', uuid.v4());
          }
        }}
        actions={
          <Button
            label={failure ? 'Reintentar mismo ajuste' : 'Confirmar ajuste'}
            loading={pending}
            disabled={pending}
            onPress={() => {
              void send();
            }}
          />
        }
      >
        {attempt && (
          <Text style={styles.body}>
            {attempt.reason === 'LOSS' ? 'Pérdida' : 'Ajuste'}: {signed(attempt.quantityDelta)}{' '}
            unidades sobre el producto seleccionado.
          </Text>
        )}
        {attempt?.notes !== undefined && attempt.notes !== null && (
          <Text style={styles.body}>Notas: {attempt.notes}</Text>
        )}
        <Text style={styles.body}>Se registrará un movimiento permanente en el historial.</Text>
        {failure && (
          <Text role="alert" style={styles.error}>
            {failure.message}
          </Text>
        )}
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: theme.spacing[16] },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[8] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  label: { ...theme.typography.bodyMedium, color: theme.colors.textPrimary },
  body: { ...theme.typography.body, color: theme.colors.textSecondary },
  error: { ...theme.typography.body, color: theme.colors.danger },
});
