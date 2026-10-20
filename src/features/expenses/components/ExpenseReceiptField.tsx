import { Text, View } from 'react-native';
import { Button } from '@/components/ui';
import type { useExpenseReceipt } from '../hooks/useExpenseReceipt';
import { expenseStyles as styles } from './expensePresentation';

export function ExpenseReceiptField({
  receipt,
  disabled,
  onAttach,
}: {
  receipt: ReturnType<typeof useExpenseReceipt>;
  disabled: boolean;
  onAttach?: () => void;
}) {
  return (
    <View style={styles.section}>
      <Text role="heading" style={styles.title}>
        Comprobante (opcional)
      </Text>
      <Text style={styles.hint}>PDF, JPEG o PNG · máximo 10 MiB. Archivo privado.</Text>
      {receipt.path && <Text style={styles.body}>Hay un comprobante guardado.</Text>}
      {receipt.file && (
        <Text style={styles.body}>
          {receipt.file.name} · {receipt.file.contentType} · {(receipt.file.size / 1024).toFixed(1)}{' '}
          KiB
        </Text>
      )}
      <Button
        label={receipt.path ? 'Seleccionar reemplazo' : 'Seleccionar comprobante'}
        variant="outline"
        disabled={disabled || receipt.busy || receipt.preview === 'pending'}
        onPress={() => void receipt.pick()}
      />
      {onAttach && receipt.file && (
        <Button
          label={receipt.error ? 'Reintentar adjunto' : 'Adjuntar comprobante'}
          disabled={disabled || receipt.busy}
          onPress={onAttach}
        />
      )}
      {receipt.busy && (
        <Text role="status" style={styles.hint}>
          Procesando comprobante…
        </Text>
      )}
      {receipt.error && (
        <Text role="alert" style={styles.error}>
          {receipt.error}
        </Text>
      )}
      {receipt.refreshError && (
        <Text role="status" style={styles.hint}>
          El comprobante se guardó, pero no se pudo actualizar la lectura.
        </Text>
      )}
      {receipt.path && (
        <Button
          label={
            receipt.preview === 'error' || receipt.preview === 'expired'
              ? 'Reintentar vista del comprobante'
              : 'Preparar vista del comprobante'
          }
          variant="secondary"
          disabled={disabled || receipt.busy || receipt.preview === 'pending'}
          onPress={() => void receipt.sign()}
        />
      )}
      {receipt.preview === 'pending' && (
        <Text role="status" style={styles.hint}>
          Preparando vista…
        </Text>
      )}
      {(receipt.preview === 'error' || receipt.preview === 'expired') && (
        <Text role="alert" style={styles.error}>
          La vista no está disponible o caducó. Solicita una nueva.
        </Text>
      )}
      {receipt.preview === 'ready' && (
        <Button
          label="Abrir comprobante"
          variant="secondary"
          disabled={disabled || receipt.busy}
          onPress={() => void receipt.open()}
        />
      )}
    </View>
  );
}
