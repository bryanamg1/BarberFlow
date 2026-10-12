import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';

import { ClientForm } from '../components/ClientForm';
import { clientsKeys } from '../constants/clientsKeys';
import { useClientDetail } from '../hooks/useClientDetail';

export function ClientEditScreen({ clientId }: { clientId: string | null }) {
  const business = useBusiness();
  const detail = useClientDetail(clientId);
  const queryClient = useQueryClient();
  const headerHeight = useHeaderHeight();
  const cancel = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/clients');
  };
  const canEdit = business.status === 'success' && clientId !== null && detail.status === 'success';
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
            Editar cliente
          </Text>
          {canEdit ? (
            <ClientForm
              key={JSON.stringify([business.data.business.id, clientId])}
              mode="edit"
              clientId={clientId}
              initialClient={detail.data}
              onSuccess={(client) =>
                router.replace({ pathname: '/clients/[id]', params: { id: client.id } })
              }
              onCancel={cancel}
            />
          ) : (
            <>
              {detail.status === 'pending' ? (
                <LoadingState message="Cargando cliente…" />
              ) : detail.status === 'error' ? (
                detail.error.code === 'CLIENT_NOT_FOUND' ? (
                  <EmptyState title="Cliente no encontrado" message={detail.error.message} />
                ) : (
                  <ErrorState
                    message={detail.error.message}
                    retrying={detail.isFetching}
                    onRetry={
                      business.status === 'success' && clientId !== null
                        ? () => {
                            void queryClient.invalidateQueries({
                              queryKey: clientsKeys.detail(business.data.business.id, clientId),
                              exact: true,
                            });
                          }
                        : undefined
                    }
                  />
                )
              ) : (
                <EmptyState title="Cliente no disponible" />
              )}
              <Button label="Cancelar" variant="secondary" onPress={cancel} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
