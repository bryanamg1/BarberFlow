import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStore } from 'zustand';

import { Button, EmptyState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';

import { CheckoutScreen } from './CheckoutScreen';
import { DirectSaleProductSelector } from '../components/DirectSaleProductSelector';
import { DirectSaleQuantityField } from '../components/DirectSaleQuantityField';
import { useCheckoutScope } from '../store/useCheckoutScope';
import {
  checkoutDraftStore,
  sameCheckoutScope,
  usableCheckoutId,
} from '../store/checkoutDraftStore';

export function DirectSaleScreen({
  clientId = null,
  validContext = true,
}: {
  clientId?: string | null;
  validContext?: boolean;
}) {
  const scope = useCheckoutScope();
  const business = useBusiness();
  const draft = useStore(checkoutDraftStore, (state) =>
    sameCheckoutScope(scope, state.scope) ? state.draft : null,
  );
  const allowed = scope !== null && business.status === 'success' && business.data.role === 'OWNER';
  const valid = validContext && (clientId === null || usableCheckoutId(clientId));
  if (
    allowed &&
    valid &&
    draft &&
    (draft.appointmentId !== null || (clientId !== null && draft.clientId !== clientId))
  )
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
        <View style={styles.content}>
          <EmptyState
            title="Hay otra venta en curso"
            message="Conservamos la intención existente. Continúala antes de iniciar una venta con otro contexto."
          />
          <Button
            label="Continuar venta en curso"
            onPress={() =>
              router.replace(
                draft.appointmentId
                  ? { pathname: '/sales/new', params: { appointmentId: draft.appointmentId } }
                  : '/sales/new',
              )
            }
          />
        </View>
      </SafeAreaView>
    );
  return (
    <CheckoutScreen
      clientId={clientId}
      validContext={valid}
      productSelector={<DirectSaleProductSelector />}
      productQuantityField={DirectSaleQuantityField}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing[16], gap: theme.spacing[16] },
});
