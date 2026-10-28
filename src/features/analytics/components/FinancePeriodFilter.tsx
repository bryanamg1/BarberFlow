import { Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { theme } from '@/theme';

import { FINANCE_PERIODS, type FinancePeriod } from '../utils/financePeriod';

export type FinancePeriodFilterProps = {
  value: FinancePeriod;
  onChange: (value: FinancePeriod) => void;
};

export const financePeriodLabels: Record<FinancePeriod, string> = {
  TODAY: 'Hoy',
  WEEK: 'Semana',
  MONTH: 'Mes',
  YEAR: 'Año',
  ALL_TIME: 'Todo el historial',
};

// OWNER Finance composition (BF256) owns selection, context and data queries.
export function FinancePeriodFilter({ value, onChange }: FinancePeriodFilterProps) {
  return (
    <View style={styles.section}>
      <View role="group" accessibilityLabel="Período financiero" style={styles.options}>
        {FINANCE_PERIODS.map((period) => {
          const selected = value === period;
          return (
            <Button
              key={period}
              label={financePeriodLabels[period]}
              variant={selected ? 'primary' : 'outline'}
              accessibilityState={Platform.OS === 'web' ? undefined : { selected }}
              {...(Platform.OS === 'web' ? { 'aria-pressed': selected } : {})}
              onPress={() => onChange(period)}
            />
          );
        })}
      </View>
      <Text style={styles.caption}>Período actual: {financePeriodLabels[value]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { width: '100%', maxWidth: 1200, alignSelf: 'center', gap: theme.spacing[8] },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[8] },
  caption: { ...theme.typography.caption, color: theme.colors.textSecondary },
});
