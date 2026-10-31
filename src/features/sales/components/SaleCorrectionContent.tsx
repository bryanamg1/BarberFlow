import { Text, View } from 'react-native';
import { Card, ErrorState } from '@/components/ui';
import { saleRestitution, saleCorrectionError } from '../services/saleCorrection';
import type { SaleCorrectionData } from '../types/saleCorrection.types';
import type { SaleItemRow } from '../types/checkout.types';
import { saleDate, saleStyles as styles } from './salePresentation';

export function SaleCorrectionContent({
  data,
  items,
  userId,
  timezone,
}: {
  data: SaleCorrectionData;
  items: SaleItemRow[];
  userId: string;
  timezone: string;
}) {
  const rows = saleRestitution(data, items),
    correction = data.correction;
  if (!correction || rows === null)
    return <ErrorState message={saleCorrectionError('INCOMPLETE_HISTORY').message} />;
  return (
    <View style={styles.section}>
      <Text role="heading" style={styles.heading}>
        Anulación de venta
      </Text>
      <Card style={styles.section}>
        <Text style={styles.text}>Motivo: {correction.reason}</Text>
        <Text style={styles.text}>
          Fecha de anulación: {saleDate(correction.created_at, timezone)}
        </Text>
        <Text style={styles.text}>
          Anulada por: {correction.created_by === userId ? 'Tú' : 'Otro OWNER'}
        </Text>
      </Card>
      {rows.length > 0 && (
        <>
          <Text role="heading" style={styles.heading}>
            Stock restituido
          </Text>
          {rows.map((row) => (
            <Card key={row.key} style={styles.section}>
              <Text style={styles.text}>{row.name}</Text>
              <Text style={styles.text}>Cantidad restituida: {row.quantity}</Text>
            </Card>
          ))}
        </>
      )}
    </View>
  );
}
