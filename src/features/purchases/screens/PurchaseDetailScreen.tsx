import { uuid } from 'expo-modules-core';
import { router, useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, ErrorState, Input, LoadingState, Modal } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';

import { PurchaseAccess } from '../components/PurchaseAccess';
import { PurchaseDetailContent } from '../components/PurchaseDetailContent';
import { purchaseLayout, purchaseStyles as styles } from '../components/purchasePresentation';
import { usePurchaseDetail } from '../hooks/usePurchaseDetail';
import { usePurchaseScope } from '../hooks/usePurchaseScope';
import { useVoidPurchase } from '../hooks/useVoidPurchase';
import { usePurchaseDialogFocus } from '../hooks/usePurchaseDialogFocus';
import { voidPurchaseSchema, type VoidPurchaseInput } from '../schemas/voidPurchase.schema';
import { purchaseDetailFromVoid } from '../services/purchaseDetailFromVoid';

export function PurchaseDetailScreen({ purchaseId }: { purchaseId: string | null }) {
  const scope = usePurchaseScope();
  const focused = useIsFocused();
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      {scope && focused ? (
        <Detail key={JSON.stringify({ ...scope, purchaseId })} purchaseId={purchaseId} />
      ) : scope ? null : (
        <PurchaseAccess />
      )}
    </SafeAreaView>
  );
}
function Detail({ purchaseId }: { purchaseId: string | null }) {
  const result = usePurchaseDetail(purchaseId);
  const correction = useVoidPurchase(purchaseId);
  const business = useBusiness();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [intent, setIntent] = useState<VoidPurchaseInput | null>(null);
  const { inputRef, triggerRef } = usePurchaseDialogFocus(open);
  const successRef = useRef<Text>(null);
  const intentRef = useRef<VoidPurchaseInput | null>(null);
  const announced = useRef(false);
  const data =
    correction.status === 'success' && result.error?.code !== 'ACCESS_DENIED'
      ? purchaseDetailFromVoid(correction.data, result.data ?? undefined)
      : result.status === 'success'
        ? result.data
        : null;
  const pending = correction.status === 'pending';
  const ambiguous =
    correction.status === 'error' &&
    ['NETWORK_ERROR', 'UNKNOWN_ERROR', 'CONFLICT'].includes(correction.error.code);
  useEffect(() => {
    if (correction.status !== 'success' || announced.current) return;
    announced.current = true;
    setOpen(false);
    if (Platform.OS !== 'web')
      AccessibilityInfo.announceForAccessibility('Compra anulada en BarberFlow');
    const timer = setTimeout(() => {
      if (Platform.OS === 'web' && typeof document !== 'undefined')
        document.getElementById('purchase-void-success')?.focus();
      else if (successRef.current)
        AccessibilityInfo.sendAccessibilityEvent(successRef.current, 'focus');
    }, 0);
    return () => clearTimeout(timer);
  }, [correction.status]);
  const close = () => {
    if (!pending) {
      setOpen(false);
      if (Platform.OS !== 'web' && triggerRef.current)
        AccessibilityInfo.sendAccessibilityEvent(triggerRef.current, 'focus');
      if (!ambiguous) {
        intentRef.current = null;
        setIntent(null);
        setReason('');
        correction.reset();
      }
    }
  };
  const submit = () => {
    if (pending) return;
    if (intent && ambiguous) {
      void correction.retry().catch(() => undefined);
      return;
    }
    const value = intentRef.current ?? {
      operationId: uuid.v4(),
      purchaseId: purchaseId ?? '',
      reason,
    };
    const parsed = voidPurchaseSchema.safeParse(value);
    if (!parsed.success) {
      setReasonError('Escribe el motivo de la anulación.');
      return;
    }
    setReasonError(undefined);
    intentRef.current = parsed.data;
    setIntent(parsed.data);
    void correction.mutateAsync(parsed.data).catch(() => undefined);
  };
  if (business.status !== 'success') return null;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text role="heading" style={styles.heading}>
        Detalle de compra
      </Text>
      <Button
        label="Volver a compras"
        variant="secondary"
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/purchases');
        }}
      />
      {correction.status === 'success' && (
        <Text
          ref={successRef}
          id="purchase-void-success"
          tabIndex={-1}
          accessible
          role="status"
          aria-live="polite"
          style={styles.body}
        >
          Compra anulada en BarberFlow
        </Text>
      )}
      {!data ? (
        result.status === 'pending' ? (
          <LoadingState message="Cargando compra…" />
        ) : result.status === 'error' ? (
          <ErrorState
            message={result.error.message}
            retrying={result.isFetching}
            onRetry={() => {
              void result.refetch();
            }}
          />
        ) : null
      ) : (
        <>
          <PurchaseDetailContent
            data={data}
            currency={business.data.business.currency_code}
            timezone={business.data.business.timezone}
            wide={width >= purchaseLayout.breakpoint}
          />
          {(correction.refreshError ||
            (result.status === 'error' && correction.status === 'success')) && (
            <ErrorState
              title="No se pudo actualizar la lectura"
              message="La compra sigue anulada. Puedes actualizar la información sin volver a anularla."
              onRetry={() => {
                void correction.retryReads();
              }}
            />
          )}
          {data.purchase.status === 'COMPLETED' && !result.isFetching && (
            <Button
              ref={triggerRef}
              label="Anular compra"
              variant="danger"
              accessibilityHint="Acción destructiva. Revisa la compra y confirma su anulación"
              disabled={pending}
              onPress={() => setOpen(true)}
            />
          )}
          {data.purchase.status === 'VOIDED' && data.voidInfo.status === 'unavailable' && (
            <Button
              label="Actualizar información de anulación"
              variant="secondary"
              onPress={() => {
                void result.refetch();
              }}
            />
          )}
        </>
      )}
      <Modal
        visible={open}
        onClose={close}
        dismissible={!pending}
        title="Anular compra"
        description="La compra quedará anulada. Se descontarán las unidades compradas del stock si es posible y el gasto dejará de contar en su período original. El registro se conservará. Esto no devuelve dinero."
        actions={
          <View style={styles.section}>
            <Button label="Cancelar" variant="secondary" disabled={pending} onPress={close} />
            <Button
              label={ambiguous ? 'Reintentar misma anulación' : 'Confirmar anulación'}
              variant="danger"
              loading={pending}
              disabled={
                pending ||
                (correction.status === 'error' && correction.error.code === 'ACCESS_DENIED')
              }
              onPress={submit}
            />
          </View>
        }
      >
        <Input
          ref={inputRef}
          label="Motivo de la anulación"
          value={ambiguous ? (intent?.reason ?? reason) : reason}
          onChangeText={(text) => {
            if (!pending && !ambiguous) {
              setReason(text);
              intentRef.current = null;
              setIntent(null);
            }
          }}
          error={reasonError}
          disabled={pending || ambiguous}
          multiline
          autoFocus
        />
        {correction.status === 'error' && <ErrorState message={correction.error.message} />}
        {correction.status === 'error' && correction.error.code === 'INVALID_STATUS' && (
          <Button
            label="Actualizar compra"
            variant="secondary"
            onPress={() => {
              close();
              void result.refetch();
            }}
          />
        )}
      </Modal>
    </ScrollView>
  );
}
