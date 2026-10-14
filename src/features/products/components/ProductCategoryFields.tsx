import { Controller, type Control } from 'react-hook-form';
import { Input } from '@/components/ui';
import type { CreateProductCategoryInput } from '../schemas/productCategory.schema';

export function ProductCategoryFields({
  control,
  disabled,
  onChange,
  onSubmit,
}: {
  control: Control<CreateProductCategoryInput>;
  disabled: boolean;
  onChange: () => void;
  onSubmit: () => void;
}) {
  return (
    <Controller
      control={control}
      name="name"
      render={({ field, fieldState }) => (
        <Input
          ref={field.ref}
          label="Nombre (obligatorio)"
          value={field.value}
          onBlur={field.onBlur}
          onChangeText={(text) => {
            if (!disabled) {
              onChange();
              field.onChange(text);
            }
          }}
          error={fieldState.error?.message}
          disabled={disabled}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (!disabled) onSubmit();
          }}
        />
      )}
    />
  );
}
