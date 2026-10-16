import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useLayoutEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { theme } from '@/theme';

import { useBusiness } from '../context/BusinessContext';
import {
  businessSettingsKey,
  useBusinessSettings,
  useSettingsScope,
  useUpdateBusinessPreferences,
} from '../hooks/useBusinessSettings';
import { businessPreferencesSchema } from '../schemas/businessSettings.schema';

const notificationFormSchema = businessPreferencesSchema.pick({ low_stock_notifications: true });

export function NotificationSettingsScreen() {
  const business = useBusiness();
  const scope = useSettingsScope();
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Notificaciones
        </Text>
        {scope !== null ? (
          <NotificationEditor key={JSON.stringify(scope)} />
        ) : business.status === 'pending' ? (
          <LoadingState message="Cargando negocio…" />
        ) : business.status === 'error' ? (
          <ErrorState message={business.error.message} />
        ) : (
          <EmptyState
            title="Acceso restringido"
            message="Solo un OWNER puede configurar las notificaciones del negocio."
          />
        )}
        <Button
          label="Volver a Configuración"
          variant="secondary"
          onPress={() => router.dismissTo('/settings')}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function NotificationEditor() {
  const query = useBusinessSettings();
  const scope = useSettingsScope();
  const client = useQueryClient();
  if (query.isError)
    return (
      <ErrorState
        message={query.error.message}
        retrying={query.isFetching}
        onRetry={() => {
          void client.invalidateQueries({ queryKey: businessSettingsKey(scope), exact: true });
        }}
      />
    );
  if (query.isSuccess)
    return <NotificationForm initial={query.data.preferences.low_stock_notifications} />;
  return <LoadingState message="Cargando preferencias…" />;
}

function NotificationForm({ initial }: { initial: boolean }) {
  const mutation = useUpdateBusinessPreferences();
  const lifetime = useRef<symbol | null>(null);
  const inFlight = useRef(false);
  const [saved, setSaved] = useState(false);
  const { control, handleSubmit, reset, formState } = useForm({
    resolver: zodResolver(notificationFormSchema),
    defaultValues: { low_stock_notifications: initial },
  });
  useLayoutEffect(() => {
    lifetime.current = Symbol();
    return () => {
      lifetime.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    if (!formState.isDirty && !inFlight.current) reset({ low_stock_notifications: initial });
  }, [initial, formState.isDirty, reset]);
  const pending = formState.isSubmitting || mutation.isPending;
  async function save() {
    if (pending || inFlight.current || !formState.isDirty || !lifetime.current) return;
    const operation = lifetime.current;
    inFlight.current = true;
    mutation.reset();
    setSaved(false);
    try {
      await handleSubmit(async ({ low_stock_notifications }) => {
        if (lifetime.current !== operation) return;
        const persisted = await mutation.mutateAsync({ low_stock_notifications });
        if (lifetime.current !== operation) return;
        reset({ low_stock_notifications: persisted.low_stock_notifications });
        setSaved(true);
        mutation.reset();
      })();
    } catch {
      // The existing hook owns safe errors; preserve the draft for an explicit retry.
    } finally {
      inFlight.current = false;
    }
  }
  return (
    <Card style={styles.form}>
      <Text style={styles.description}>
        Preferencia para avisos de stock bajo. La entrega de avisos todavía no está disponible; esta
        opción no activa notificaciones push ni correos.
      </Text>
      <Controller
        name="low_stock_notifications"
        control={control}
        render={({ field, fieldState }) => (
          <>
            <Button
              label={'Avisos de stock bajo: ' + (field.value ? 'Sí' : 'No')}
              variant="secondary"
              disabled={pending}
              onPress={() => {
                field.onChange(!field.value);
                setSaved(false);
                mutation.reset();
              }}
            />
            {fieldState.error && (
              <Text role="alert" style={styles.error}>
                Revisa la preferencia.
              </Text>
            )}
          </>
        )}
      />
      {mutation.error && (
        <Text role="alert" aria-live="assertive" style={styles.error}>
          {mutation.error.message}
        </Text>
      )}
      {saved && (
        <Text role="status" aria-live="polite" style={styles.description}>
          Preferencia guardada.
        </Text>
      )}
      <Button
        label="Guardar notificaciones"
        loading={pending}
        disabled={pending || !formState.isDirty}
        onPress={() => void save()}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing[16], gap: theme.spacing[16] },
  form: { gap: theme.spacing[16] },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
  description: { ...theme.typography.body, color: theme.colors.textSecondary },
  error: { ...theme.typography.body, color: theme.colors.danger },
});
