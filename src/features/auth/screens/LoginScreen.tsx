import { Link } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card } from '@/components/ui';
import { theme } from '@/theme';

import { LoginForm } from '../components/LoginForm';

export function LoginScreen() {
  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        enabled={Platform.OS !== 'web'}
        style={styles.fill}
      >
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.content}>
            <View style={styles.header}>
              <Text role="heading" style={styles.title}>
                BarberFlow
              </Text>
              <Text style={styles.subtitle}>Inicia sesión para continuar</Text>
            </View>
            <Card>
              <LoginForm />
            </Card>
            <Link href="/forgot-password" style={styles.link}>
              Olvidé mi contraseña
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  fill: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing[24],
  },
  // A screen-specific content bound keeps the form usable on wide web viewports.
  content: { width: '100%', maxWidth: 480, gap: theme.spacing[24] },
  header: { gap: theme.spacing[8] },
  title: { ...theme.typography.display, color: theme.colors.textPrimary },
  subtitle: { ...theme.typography.bodyLg, color: theme.colors.textSecondary },
  link: {
    ...theme.typography.body,
    color: theme.colors.primary,
    minHeight: theme.sizing.touchTargetMin,
  },
});
