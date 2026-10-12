import type { Ref } from 'react';
import type { TextInput } from 'react-native';

import { Input } from '@/components/ui';

export const clientTextFields = [
  { name: 'first_name', label: 'Nombre (obligatorio)' },
  { name: 'last_name', label: 'Apellido' },
  { name: 'phone', label: 'Teléfono' },
  { name: 'email', label: 'Email' },
  { name: 'instagram', label: 'Instagram' },
  { name: 'birth_date', label: 'Fecha de nacimiento' },
  { name: 'notes', label: 'Notas' },
  { name: 'preferences', label: 'Preferencias' },
] as const;

export function ClientTextField({
  field,
  value,
  onChange,
  onBlur,
  inputRef,
  error,
  disabled,
  onNext,
}: {
  field: (typeof clientTextFields)[number];
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  onBlur: () => void;
  inputRef: Ref<TextInput>;
  error?: string;
  disabled: boolean;
  onNext?: () => void;
}) {
  const { name, label } = field;
  const multiline = name === 'notes' || name === 'preferences';
  return (
    <Input
      ref={inputRef}
      label={label}
      value={value ?? ''}
      onBlur={onBlur}
      onChangeText={(text) => onChange(name === 'birth_date' && text === '' ? null : text)}
      error={error}
      disabled={disabled}
      helperText={name === 'birth_date' ? 'YYYY-MM-DD (opcional)' : undefined}
      placeholder={name === 'birth_date' ? 'YYYY-MM-DD' : undefined}
      multiline={multiline}
      numberOfLines={multiline ? 4 : 1}
      autoCapitalize={name === 'email' || name === 'instagram' ? 'none' : 'sentences'}
      keyboardType={name === 'phone' ? 'phone-pad' : name === 'email' ? 'email-address' : 'default'}
      returnKeyType={multiline ? 'default' : 'next'}
      submitBehavior={multiline ? 'newline' : 'submit'}
      onSubmitEditing={multiline ? undefined : onNext}
    />
  );
}
