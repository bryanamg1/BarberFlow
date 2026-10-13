import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';

import { ServiceForm } from '../components/ServiceForm';
import { servicesKeys } from '../constants/servicesKeys';
import { useServiceDetail } from '../hooks/useServiceDetail';

const cancel = () => {
  if (router.canGoBack()) router.back();
  else router.replace('/services');
};

export function ServiceEditScreen({ serviceId }: { serviceId: string | null }) {
  const business = useBusiness();
  const headerHeight = useHeaderHeight();
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={Platform.OS !== 'web'}
        keyboardVerticalOffset={headerHeight}
        style={styles.fill}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.content}
        >
          <Text role="heading" style={styles.heading}>
            Editar servicio
          </Text>
          {business.status === 'success' && business.data.role === 'OWNER' && serviceId !== null ? (
            <ServiceEditor
              key={JSON.stringify([business.data.business.id, serviceId])}
              serviceId={serviceId}
              businessId={business.data.business.id}
              currency={business.data.business.currency_code}
            />
          ) : (
            <>
              {business.status === 'pending' ? (
                <LoadingState message="Cargando negocio…" />
              ) : business.status === 'error' ? (
                <ErrorState message={business.error.message} />
              ) : business.status === 'success' && business.data.role !== 'OWNER' ? (
                <EmptyState
                  title="Acceso restringido"
                  message="Solo un OWNER puede gestionar servicios."
                />
              ) : (
                <EmptyState title="Servicio no disponible" />
              )}
              <Button label="Cancelar" variant="secondary" onPress={cancel} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ServiceEditor({
  serviceId,
  businessId,
  currency,
}: {
  serviceId: string;
  businessId: string;
  currency: string;
}) {
  const detail = useServiceDetail(serviceId);
  const queryClient = useQueryClient();
  if (detail.status === 'success')
    return (
      <ServiceForm
        mode="edit"
        serviceId={serviceId}
        initialService={detail.data}
        currency={currency}
        onCancel={cancel}
      />
    );
  return (
    <>
      {detail.status === 'pending' ? (
        <LoadingState message="Cargando servicio…" />
      ) : detail.status === 'error' ? (
        detail.error.code === 'SERVICE_NOT_FOUND' ? (
          <EmptyState title="Servicio no encontrado" message={detail.error.message} />
        ) : (
          <ErrorState
            message={detail.error.message}
            retrying={detail.isFetching}
            onRetry={() => {
              void queryClient.invalidateQueries({
                queryKey: servicesKeys.detail(businessId, serviceId),
                exact: true,
              });
            }}
          />
        )
      ) : (
        <EmptyState title="Servicio no disponible" />
      )}
      <Button label="Cancelar" variant="secondary" onPress={cancel} />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  fill: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    padding: theme.spacing[16],
    gap: theme.spacing[24],
  },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
});
