import { useImperativeHandle, useRef, useState } from 'react';
import { type TextInput } from 'react-native';

import { Button } from './Button';
import { Input, type InputProps } from './Input';

export type PasswordInputProps = Omit<
  InputProps,
  'secureTextEntry' | 'multiline' | 'keyboardType' | 'inputMode' | 'trailingAccessory'
>;

export function PasswordInput({
  label,
  disabled = false,
  editable = true,
  readOnly = false,
  autoComplete = 'current-password',
  ref,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<TextInput>(null);
  useImperativeHandle(ref, () => inputRef.current!, []);
  const blocked = disabled || !editable || readOnly;
  const name =
    label !== undefined
      ? { label }
      : props.accessibilityLabel
        ? { accessibilityLabel: props.accessibilityLabel }
        : { label: 'Contraseña' };

  return (
    <Input
      {...props}
      {...name}
      ref={inputRef}
      disabled={disabled}
      editable={editable}
      readOnly={readOnly}
      autoComplete={autoComplete}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      multiline={false}
      keyboardType="default"
      inputMode="text"
      secureTextEntry={!visible}
      trailingAccessory={
        <Button
          label={visible ? 'Ocultar' : 'Mostrar'}
          accessibilityLabel={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          variant="ghost"
          disabled={blocked}
          onPress={() => {
            if (blocked) return;
            setVisible((current) => !current);
            inputRef.current?.focus();
          }}
        />
      }
    />
  );
}
