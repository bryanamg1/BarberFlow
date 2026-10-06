import { useImperativeHandle, useRef } from 'react';
import { type TextInput } from 'react-native';

import { Button } from './Button';
import { Input, type InputProps } from './Input';

export type SearchInputProps = Omit<
  InputProps,
  'value' | 'defaultValue' | 'onChangeText' | 'secureTextEntry' | 'multiline' | 'trailingAccessory'
> & {
  value: string;
  onChangeText: (value: string) => void;
};

export function SearchInput({
  label,
  value,
  onChangeText,
  disabled = false,
  editable = true,
  readOnly = false,
  ref,
  ...props
}: SearchInputProps) {
  const inputRef = useRef<TextInput>(null);
  useImperativeHandle(ref, () => inputRef.current!, []);
  const blocked = disabled || !editable || readOnly;
  const name =
    label !== undefined
      ? { label }
      : props.accessibilityLabel
        ? { accessibilityLabel: props.accessibilityLabel }
        : { label: 'Buscar' };

  return (
    <Input
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="off"
      inputMode="search"
      enterKeyHint="search"
      {...props}
      {...name}
      ref={inputRef}
      value={value}
      onChangeText={onChangeText}
      disabled={disabled}
      editable={editable}
      readOnly={readOnly}
      secureTextEntry={false}
      multiline={false}
      trailingAccessory={
        value.length > 0 && (
          <Button
            label="Limpiar"
            accessibilityLabel="Limpiar búsqueda"
            variant="ghost"
            disabled={blocked}
            onPress={() => {
              if (blocked) return;
              onChangeText('');
              inputRef.current?.focus();
            }}
          />
        )
      }
    />
  );
}
