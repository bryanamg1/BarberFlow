import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { theme } from '@/theme';

import { ExpenseCategoryForm } from '../components/ExpenseCategoryForm';

export function ExpenseCategoryCreateScreen() {
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
            Crear categoría
          </Text>
          {business.status === 'success' ? (
            business.data.role === 'OWNER' ? (
              <ExpenseCategoryForm
                key={business.data.business.id}
                onSuccess={(created) =>
                  router.replace({
                    pathname: '/expenses/categories/[id]/edit',
                    params: { id: created.id },
                  })
                }
                onCancel={() => {
                  if (router.canGoBack()) router.back();
                  else router.replace('/expenses/categories');
                }}
              />
            ) : (
              <EmptyState
                title="Acceso restringido"
                message="Solo un OWNER puede crear categorías."
              />
            )
          ) : business.status === 'pending' ? (
            <LoadingState message="Cargando negocio…" />
          ) : business.status === 'error' ? (
            <ErrorState message={business.error.message} />
          ) : (
            <EmptyState
              title="Negocio no disponible"
              message="Necesitas un negocio disponible para crear categorías."
            />
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
    alignSelf: 'center',
    padding: theme.spacing[16],
    gap: theme.spacing[24],
  },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
});
