import { Controller, type Control, type UseFormSetFocus } from 'react-hook-form';
import { Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';

import type { CreateManualExpenseInput } from '../schemas/expense.schema';
import { ExpenseCategorySelect } from './ExpenseCategorySelect';
import { expensePaymentLabels, expenseStyles as styles } from './expensePresentation';

export function ManualExpenseFields({
  control,
  setFocus,
  disabled,
  currency,
  onChange,
  onSubmit,
}: {
  control: Control<CreateManualExpenseInput>;
  setFocus: UseFormSetFocus<CreateManualExpenseInput>;
  disabled: boolean;
  currency: string;
  onChange: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <Controller
        control={control}
        name="category_id"
        render={({ field, fieldState }) => (
          <ExpenseCategorySelect
            value={field.value}
            disabled={disabled}
            error={fieldState.error?.message}
            onChange={(value) => {
              if (!disabled && value !== undefined) {
                onChange();
                field.onChange(value);
                field.onBlur();
              }
            }}
          />
        )}
      />
      {(['description', 'amount', 'expense_date', 'notes'] as const).map((name, index, names) => (
        <Controller
          key={name}
          control={control}
          name={name}
          render={({ field, fieldState }) => (
            <Input
              ref={field.ref}
              label={
                {
                  description: 'Descripción (obligatoria)',
                  amount: 'Importe (obligatorio)',
                  expense_date: 'Fecha del gasto (YYYY-MM-DD, obligatoria)',
                  notes: 'Notas (opcional)',
                }[name]
              }
              value={field.value ?? ''}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
              disabled={disabled}
              onChangeText={(text) => {
                if (!disabled) {
                  onChange();
                  field.onChange(text);
                }
              }}
              multiline={name === 'notes'}
              inputMode={name === 'amount' ? 'decimal' : 'text'}
              keyboardType={name === 'amount' ? 'decimal-pad' : 'default'}
              autoCapitalize={name === 'amount' || name === 'expense_date' ? 'none' : 'sentences'}
              helperText={
                name === 'amount'
                  ? `${currency} · Usa punto y hasta dos decimales. Se permite cero.`
                  : name === 'expense_date'
                    ? 'Fecha civil, sin hora.'
                    : undefined
              }
              returnKeyType={name === 'notes' ? 'default' : 'next'}
              onSubmitEditing={
                name === 'notes'
                  ? undefined
                  : () => {
                      if (!disabled) {
                        const next = names[index + 1];
                        if (next) setFocus(next);
                        else onSubmit();
                      }
                    }
              }
            />
          )}
        />
      ))}
      <Controller
        control={control}
        name="payment_method"
        render={({ field, fieldState }) => (
          <View style={styles.section}>
            <Text style={styles.body}>Medio de pago (obligatorio)</Text>
            <View style={styles.controls}>
              {Object.entries(expensePaymentLabels).map(([code, label]) => (
                <Button
                  key={code}
                  label={label}
                  variant={field.value === code ? 'primary' : 'outline'}
                  disabled={disabled}
                  accessibilityLabel={`Medio de pago: ${label}`}
                  accessibilityState={{ selected: field.value === code }}
                  onPress={() => {
                    if (!disabled) {
                      onChange();
                      field.onChange(code);
                      field.onBlur();
                    }
                  }}
                />
              ))}
            </View>
            {fieldState.error && (
              <Text role="alert" style={styles.error}>
                {fieldState.error.message}
              </Text>
            )}
          </View>
        )}
      />
    </>
  );
}
