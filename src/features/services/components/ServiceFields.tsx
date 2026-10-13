import { Controller, type Control, type FieldValues, type UseFormSetFocus } from 'react-hook-form';

import { Input } from '@/components/ui';

import type { ServiceCreateFormValues } from './serviceCreateForm.schema';

const fields = [
  { name: 'name', label: 'Nombre (obligatorio)' },
  { name: 'description', label: 'Descripción' },
  { name: 'price', label: 'Precio (obligatorio)' },
  { name: 'duration_minutes', label: 'Duración en minutos (obligatorio)' },
] as const;

export function ServiceFields<TOutput extends FieldValues>({
  control,
  setFocus,
  disabled,
  currency,
  onChange,
  onSubmit,
}: {
  control: Control<ServiceCreateFormValues, unknown, TOutput>;
  setFocus: UseFormSetFocus<ServiceCreateFormValues>;
  disabled: boolean;
  currency: string;
  onChange: () => void;
  onSubmit: () => void;
}) {
  return fields.map((field, index) => (
    <Controller
      key={field.name}
      control={control}
      name={field.name}
      render={({ field: { ref, value, onChange: changeValue, onBlur }, fieldState: { error } }) => (
        <Input
          ref={ref}
          label={field.label}
          value={value ?? ''}
          onBlur={onBlur}
          onChangeText={(text) => {
            if (disabled) return;
            onChange();
            changeValue(text);
          }}
          error={error?.message}
          disabled={disabled}
          multiline={field.name === 'description'}
          keyboardType={
            field.name === 'price'
              ? 'decimal-pad'
              : field.name === 'duration_minutes'
                ? 'number-pad'
                : 'default'
          }
          inputMode={
            field.name === 'price'
              ? 'decimal'
              : field.name === 'duration_minutes'
                ? 'numeric'
                : 'text'
          }
          helperText={
            field.name === 'price'
              ? `${currency} · Usa punto para decimales (ej. 10000.50).`
              : undefined
          }
          autoCapitalize={
            field.name === 'price' || field.name === 'duration_minutes' ? 'none' : 'sentences'
          }
          returnKeyType={field.name === 'duration_minutes' ? 'done' : 'next'}
          onSubmitEditing={
            field.name === 'description'
              ? undefined
              : () => {
                  if (disabled) return;
                  const next = fields[index + 1];
                  if (next) setFocus(next.name);
                  else onSubmit();
                }
          }
        />
      )}
    />
  ));
}
