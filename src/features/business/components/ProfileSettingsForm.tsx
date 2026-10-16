import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar, Button, Card, Input } from '@/components/ui';
import { theme } from '@/theme';
import type { useProfileSettings } from '../hooks/useProfileSettings';
import {
  profileUpdateSchema,
  type ProfileRow,
  type ProfileUpdateInput,
} from '../schemas/profile.schema';

export function ProfileSettingsForm({
  profile,
  controller,
}: {
  profile: ProfileRow;
  controller: ReturnType<typeof useProfileSettings>;
}) {
  const {
    control,
    handleSubmit,
    getValues,
    reset,
    setValue,
    formState: { dirtyFields },
  } = useForm<ProfileUpdateInput>({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: {
      first_name: profile.first_name,
      last_name: profile.last_name,
      phone: profile.phone,
    },
  });
  useEffect(() => {
    reset(
      { first_name: profile.first_name, last_name: profile.last_name, phone: profile.phone },
      { keepDirtyValues: true },
    );
  }, [profile.first_name, profile.last_name, profile.phone, reset]);
  const submit = handleSubmit(async () => {
    const input: ProfileUpdateInput = {};
    for (const field of ['first_name', 'last_name', 'phone'] as const)
      if (dirtyFields[field]) Object.assign(input, { [field]: getValues(field) });
    if (Object.keys(input).length) {
      const saved = await controller.save(input);
      if (saved)
        reset({ first_name: saved.first_name, last_name: saved.last_name, phone: saved.phone });
    }
  });
  const dirty = !!(dirtyFields.first_name || dirtyFields.last_name || dirtyFields.phone);
  return (
    <View style={styles.section}>
      <Card style={styles.section}>
        <Avatar
          label={`${profile.first_name} ${profile.last_name}`}
          imageUri={controller.imageUri}
          accessibilityLabel="Avatar del perfil"
        />
        <Button
          label="Cambiar avatar"
          variant="secondary"
          disabled={controller.busy}
          onPress={() => {
            void controller.changeAvatar();
          }}
        />
        <Text style={styles.description}>Una imagen JPEG o PNG de hasta 5 MiB.</Text>
        {controller.imageError && (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {controller.imageError.message}
          </Text>
        )}
      </Card>
      <Input
        label="Correo electrónico"
        value={controller.email}
        readOnly
        helperText="El correo de acceso no se modifica desde el perfil."
      />
      {(['first_name', 'last_name', 'phone'] as const).map((field) => (
        <Controller
          key={field}
          control={control}
          name={field}
          render={({ field: input }) => (
            <Input
              label={
                field === 'first_name' ? 'Nombre' : field === 'last_name' ? 'Apellido' : 'Teléfono'
              }
              value={input.value ?? ''}
              onChangeText={input.onChange}
              onBlur={input.onBlur}
              ref={input.ref}
              disabled={controller.busy}
              keyboardType={field === 'phone' ? 'phone-pad' : 'default'}
              autoComplete={
                field === 'phone' ? 'tel' : field === 'first_name' ? 'given-name' : 'family-name'
              }
            />
          )}
        />
      ))}
      <Button
        label="Quitar teléfono"
        variant="ghost"
        disabled={controller.busy}
        onPress={() => setValue('phone', null, { shouldDirty: true })}
      />
      {controller.error && (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {controller.error.message}
        </Text>
      )}
      {controller.message && (
        <Text accessibilityLiveRegion="polite" style={styles.description}>
          {controller.message}
        </Text>
      )}
      <Button
        label="Guardar perfil"
        loading={controller.busy}
        disabled={!dirty || controller.busy}
        onPress={() => {
          void submit();
        }}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: theme.spacing[16] },
  description: { ...theme.typography.body, color: theme.colors.textSecondary },
  error: { ...theme.typography.body, color: theme.colors.danger },
});
