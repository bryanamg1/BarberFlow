import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Text, type TextInput, View } from 'react-native';
import { Button, ErrorState, Input, Modal } from '@/components/ui';
import type { SaleCorrectionError } from '../types/saleCorrection.types';
import { saleStyles as styles } from './salePresentation';

export function SaleVoidAction({
  available,
  pending,
  error,
  onConfirm,
  onReset,
  success,
}: {
  available: boolean;
  pending: boolean;
  error: SaleCorrectionError | null;
  onConfirm: (reason: string) => void;
  onReset: () => void;
  success: boolean;
}) {
  const [requestedOpen, setOpen] = useState(false),
    [reason, setReason] = useState(''),
    [invalid, setInvalid] = useState(false);
  const input = useRef<TextInput>(null),
    trigger = useRef<View>(null),
    successRef = useRef<Text>(null),
    wasOpen = useRef(false);
  const terminalError =
    error !== null && ['ACCESS_DENIED', 'NOT_FOUND', 'INVALID_STATUS'].includes(error.code);
  const open = requestedOpen && !success && !terminalError;
  useEffect(() => {
    const closing = wasOpen.current && !open;
    wasOpen.current = open;
    if (!open && !closing && !success) return;
    const timer = setTimeout(() => {
      if (open) input.current?.focus();
      else if (success) {
        if (Platform.OS === 'web' && typeof document !== 'undefined')
          document.getElementById('sale-void-success')?.focus();
        else if (successRef.current)
          AccessibilityInfo.sendAccessibilityEvent(successRef.current, 'focus');
      } else if (trigger.current) {
        trigger.current.focus();
        if (Platform.OS !== 'web')
          AccessibilityInfo.sendAccessibilityEvent(trigger.current, 'focus');
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [open, success]);
  const close = () => {
    if (!pending) {
      setOpen(false);
      setReason('');
      setInvalid(false);
      onReset();
    }
  };
  return (
    <>
      {success && (
        <Text
          ref={successRef}
          id="sale-void-success"
          tabIndex={-1}
          role="status"
          aria-live="polite"
          style={styles.text}
        >
          Venta anulada en BarberFlow
        </Text>
      )}
      {available && (
        <Button
          ref={trigger}
          label="Anular venta"
          variant="danger"
          accessibilityHint="Acción destructiva. Revisa y confirma la anulación de esta venta"
          onPress={() => {
            if (terminalError) {
              onReset();
              setReason('');
              setInvalid(false);
            }
            setOpen(true);
          }}
        />
      )}
      {!open && error && <ErrorState message={error.message} />}
      <Modal
        visible={open}
        title="Anular venta"
        description="Esta acción anula la venta y restituye el stock de los productos. No genera un reembolso."
        dismissible={!pending}
        onClose={close}
        actions={
          <View style={styles.section}>
            <Button label="Cancelar" variant="secondary" disabled={pending} onPress={close} />
            <Button
              label="Anular venta"
              variant="danger"
              accessibilityHint="Confirma la acción destructiva"
              loading={pending}
              disabled={pending}
              onPress={() => {
                if (pending) return;
                if (!reason.trim()) {
                  setInvalid(true);
                  return;
                }
                setInvalid(false);
                onConfirm(reason);
              }}
            />
          </View>
        }
      >
        <Input
          ref={input}
          label="Motivo"
          value={reason}
          disabled={pending}
          multiline
          autoFocus
          error={invalid ? 'Escribe el motivo de la anulación.' : undefined}
          onChangeText={(value) => {
            if (!pending) {
              if (value !== reason) onReset();
              setReason(value);
              setInvalid(false);
            }
          }}
        />
        {error && <ErrorState message={error.message} />}
      </Modal>
    </>
  );
}
