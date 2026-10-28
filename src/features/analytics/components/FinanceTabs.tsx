import { Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { theme } from '@/theme';

export const FINANCE_TABS = ['overview', 'services', 'products', 'expenses'] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number];
// For the BF256 parent to initialize its state; never a local component default.
export const DEFAULT_FINANCE_TAB: FinanceTab = 'overview';
const labels: Record<FinanceTab, string> = {
  overview: 'Resumen',
  services: 'Servicios',
  products: 'Productos',
  expenses: 'Gastos',
};
export type FinanceTabsProps = { value: FinanceTab; onChange: (value: FinanceTab) => void };

// The authorized Finance parent owns this value, period and rendered content.
export function FinanceTabs({ value, onChange }: FinanceTabsProps) {
  return (
    <View style={styles.section}>
      <View role="group" accessibilityLabel="Sección de Finanzas" style={styles.controls}>
        {FINANCE_TABS.map((tab) => {
          const selected = value === tab;
          return (
            <Button
              key={tab}
              label={labels[tab]}
              variant={selected ? 'primary' : 'outline'}
              accessibilityState={Platform.OS === 'web' ? undefined : { selected }}
              {...(Platform.OS === 'web' ? { 'aria-pressed': selected } : {})}
              onPress={() => onChange(tab)}
            />
          );
        })}
      </View>
      <Text style={styles.caption}>Sección actual: {labels[value]}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  section: { width: '100%', maxWidth: 1200, alignSelf: 'center', gap: theme.spacing[8] },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[8] },
  caption: { ...theme.typography.caption, color: theme.colors.textSecondary },
});
