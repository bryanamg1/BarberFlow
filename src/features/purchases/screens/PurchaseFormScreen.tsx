import { uuid } from 'expo-modules-core';
import { router, useIsFocused } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from 'zustand';
import { Button, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { usePurchaseScope } from '../hooks/usePurchaseScope';
import { usePurchaseFormSubmission } from '../hooks/usePurchaseFormSubmission';
import { purchaseDraftStore } from '../store/purchaseDraftStore';
import type { PurchaseScope } from '../types/purchaseRead.types';
import { PurchaseAccess } from '../components/PurchaseAccess';
import { PurchaseForm } from '../components/PurchaseForm';
import { purchaseStyles as styles } from '../components/purchasePresentation';

export function PurchaseFormScreen() {
  const scope = usePurchaseScope(),
    business = useBusiness(),
    focused = useIsFocused(),
    headerHeight = useHeaderHeight();
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={Platform.OS !== 'web'}
        keyboardVerticalOffset={headerHeight}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.content}
        >
          <Text role="heading" style={styles.heading}>
            Nueva compra
          </Text>
          {scope && focused && business.status === 'success' ? (
            <Content
              key={JSON.stringify(scope)}
              scope={scope}
              currency={business.data.business.currency_code}
              timezone={business.data.business.timezone}
            />
          ) : (
            <PurchaseAccess />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
function Content({
  scope,
  currency,
  timezone,
}: {
  scope: PurchaseScope;
  currency: string;
  timezone: string;
}) {
  const state = useStore(purchaseDraftStore);
  const submission = usePurchaseFormSubmission(scope, (data) =>
    router.replace({ pathname: '/purchases/[id]', params: { id: data.purchase.id } }),
  );
  const draft = state.businessId === scope.businessId ? state.draft : null;
  const cancelled = useRef(false);
  useEffect(() => {
    const s = purchaseDraftStore.getState();
    if (
      !cancelled.current &&
      s.businessId === scope.businessId &&
      s.draft === null &&
      submission.phase === 'idle'
    )
      s.startDraft(scope.businessId, uuid.v4());
  }, [scope.businessId, state.businessId, draft, submission.phase]);
  function cancel() {
    if (draft && submission.phase === 'idle') cancelled.current = true;
    if (
      draft &&
      submission.phase === 'idle' &&
      purchaseDraftStore.getState().clearDraft(scope.businessId, draft.operationId)
    )
      router.replace('/purchases');
  }
  const locked = submission.phase !== 'idle';
  return (
    <>
      {draft ? (
        <PurchaseForm
          key={draft.operationId}
          draft={draft}
          businessId={scope.businessId}
          currency={currency}
          timezone={timezone}
          locked={locked}
          pending={submission.phase === 'pending'}
          onSubmit={submission.submit}
          onCancel={cancel}
        />
      ) : (
        <LoadingState
          message={
            submission.phase === 'success'
              ? 'Compra confirmada. Abriendo detalle…'
              : 'Preparando compra…'
          }
        />
      )}
      {submission.error && <ErrorState message={submission.error.message} />}
      {submission.phase === 'pending' && <LoadingState message="Registrando compra…" />}
      {submission.phase === 'uncertain' && (
        <>
          <Text role="alert" style={styles.body}>
            Reintenta la misma intención. No edites ni inicies otra compra mientras su resultado sea
            incierto.
          </Text>
          <Button label="Reintentar compra original" onPress={() => void submission.retry()} />
        </>
      )}
      {submission.phase === 'error' && (
        <Button label="Editar con nueva intención" onPress={submission.editRejected} />
      )}
    </>
  );
}
