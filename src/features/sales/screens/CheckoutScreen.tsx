import { uuid } from 'expo-modules-core';
import { router, useIsFocused } from 'expo-router';
import { useEffect, type ReactNode, type ComponentType } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from 'zustand';

import { Button, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { useAppointmentDetail } from '@/features/appointments/hooks/useAppointmentDetail';
import { theme } from '@/theme';

import { CheckoutServiceItems } from '../components/CheckoutServiceItems';
import {
  CheckoutProductItems,
  type CheckoutProductQuantityProps,
} from '../components/CheckoutProductItems';
import { CheckoutSummary } from '../components/CheckoutSummary';
import { CheckoutDiscountField } from '../components/CheckoutDiscountField';
import { CheckoutPaymentField } from '../components/CheckoutPaymentField';
import { useCompleteCheckout } from '../hooks/useCompleteCheckout';
import {
  checkoutDraftStore,
  sameCheckoutScope,
  usableCheckoutId,
  type CheckoutScope,
} from '../store/checkoutDraftStore';
import { useCheckoutScope } from '../store/useCheckoutScope';

export function CheckoutScreen({
  appointmentId = null,
  clientId = null,
  validContext = true,
  productSelector,
  productQuantityField,
}: {
  appointmentId?: string | null;
  clientId?: string | null;
  validContext?: boolean;
  productSelector?: ReactNode;
  productQuantityField?: ComponentType<CheckoutProductQuantityProps>;
}) {
  const scope = useCheckoutScope(),
    business = useBusiness(),
    focused = useIsFocused();
  if (!scope || business.status !== 'success' || business.data.role !== 'OWNER')
    return <ErrorState message="No tienes acceso para completar una venta." />;
  if (
    !validContext ||
    (appointmentId !== null && !usableCheckoutId(appointmentId)) ||
    (clientId !== null && !usableCheckoutId(clientId))
  )
    return <ErrorState message="El contexto de la venta no es válido." />;
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      {focused && (
        <Content
          key={JSON.stringify(scope)}
          scope={scope}
          appointmentId={appointmentId}
          clientId={clientId}
          productSelector={productSelector}
          productQuantityField={productQuantityField}
        />
      )}
    </SafeAreaView>
  );
}
function Content({
  scope,
  appointmentId,
  clientId,
  productSelector,
  productQuantityField,
}: {
  scope: CheckoutScope;
  appointmentId: string | null;
  clientId: string | null;
  productSelector?: ReactNode;
  productQuantityField?: ComponentType<CheckoutProductQuantityProps>;
}) {
  const draft = useStore(checkoutDraftStore, (state) =>
    sameCheckoutScope(state.scope, scope) ? state.draft : null,
  );
  const checkout = useCompleteCheckout();
  const appointment = useAppointmentDetail(draft?.appointmentId ?? null);
  const { userId, businessId, membershipId } = scope;
  useEffect(() => {
    const state = checkoutDraftStore.getState();
    const initialScope = { userId, businessId, membershipId };
    if (sameCheckoutScope(state.scope, initialScope) && state.draft === null)
      state.startDraft(initialScope, uuid.v4(), {
        appointmentId,
        clientId: appointmentId ? null : clientId,
      });
  }, [userId, businessId, membershipId, appointmentId, clientId]);
  function cancel() {
    if (!draft || !checkoutDraftStore.getState().clearDraft(scope, draft.operationId)) return;
    if (draft.appointmentId)
      router.replace({ pathname: '/appointments/[id]', params: { id: draft.appointmentId } });
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  }
  if (checkout.status === 'success')
    return (
      <View style={styles.section}>
        <Text style={styles.heading}>Venta confirmada</Text>
        <Button
          label="Ver venta"
          onPress={() =>
            router.replace({ pathname: '/sales/[id]', params: { id: checkout.data.sale.id } })
          }
        />
      </View>
    );
  if (!draft) return <LoadingState message="Preparando intención de venta…" />;
  const linked = draft.appointmentId !== null;
  const appointmentReady = !linked || appointment.status === 'success';
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text role="heading" style={styles.heading}>
        Nueva venta
      </Text>
      <Text style={styles.text}>
        {linked ? `Venta de cita: ${draft.appointmentId}` : 'Venta directa'}
      </Text>
      {linked &&
        (appointment.status === 'success' ? (
          <Text style={styles.text}>
            Cliente de la cita: {appointment.data.client_id ?? 'Sin cliente'}. Los servicios se
            seleccionan explícitamente.
          </Text>
        ) : appointment.status === 'error' ? (
          <ErrorState
            message={appointment.error.message}
            onRetry={() => {
              void appointment.refetch();
            }}
          />
        ) : (
          <LoadingState message="Consultando contexto de la cita…" />
        ))}
      {!linked && <Text style={styles.text}>Cliente: {draft.clientId ?? 'Sin cliente'}</Text>}
      <CheckoutServiceItems />
      <CheckoutProductItems selector={productSelector} quantityField={productQuantityField} />
      <CheckoutSummary />
      <CheckoutDiscountField />
      <CheckoutPaymentField />
      {(checkout.status === 'error' || checkout.status === 'uncertain') && (
        <ErrorState message={checkout.error.message} />
      )}
      {checkout.status === 'uncertain' && (
        <>
          <Text role="alert" style={styles.text}>
            El resultado es incierto. No edites ni inicies otra venta; reintenta exactamente la
            misma intención.
          </Text>
          <Button
            label="Reintentar intención original"
            onPress={() => {
              void checkout.retry().catch(() => undefined);
            }}
          />
        </>
      )}
      {checkout.status === 'error' && (
        <Button
          label="Editar con una nueva intención"
          variant="secondary"
          onPress={() => {
            checkout.editRejected(uuid.v4());
          }}
        />
      )}
      <Button
        label="Completar venta"
        loading={checkout.status === 'pending'}
        disabled={!checkout.eligible || !appointmentReady}
        onPress={() => {
          void checkout.submit().catch(() => undefined);
        }}
      />
      <Button
        label="Cancelar venta"
        variant="ghost"
        disabled={checkout.status === 'pending' || checkout.status === 'uncertain'}
        onPress={cancel}
      />
      <Text style={styles.hint}>
        El servidor confirma importes, stock y permisos. Esta pantalla no ejecuta pagos externos.
      </Text>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing[16], gap: theme.spacing[16] },
  section: { padding: theme.spacing[16], gap: theme.spacing[16] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  text: { ...theme.typography.body, color: theme.colors.textPrimary },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary },
});
