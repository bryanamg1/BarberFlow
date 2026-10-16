import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { LowStockAlertList } from '@/features/inventory/components/LowStockAlertList';
import { useLowStockAlerts } from '@/features/inventory/hooks/useLowStockAlerts';
import { theme } from '@/theme';

export function HomeLowStock() {
  const auth = useAuth();
  const business = useBusiness();
  const scope =
    auth.status === 'authenticated' && business.status === 'success'
      ? [auth.user.id, business.data.business.id, business.data.membershipId]
      : null;
  return <Section key={JSON.stringify(scope)} />;
}
function Section() {
  const [page, setPage] = useState(1);
  const result = useLowStockAlerts(page);
  return (
    <View style={styles.section}>
      <Text role="heading" style={styles.heading}>
        Stock bajo
      </Text>
      <LowStockAlertList
        result={result}
        onPrevious={() => setPage((value) => Math.max(1, value - 1))}
        onNext={() => {
          if (result.status === 'success' && result.data.hasNextPage) setPage((value) => value + 1);
        }}
      />
      <Button
        label="Ver productos"
        variant="secondary"
        disabled={result.status === 'idle'}
        onPress={() => router.push('/products')}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: theme.spacing[16] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
});
