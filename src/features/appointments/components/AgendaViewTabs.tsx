import { Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { theme } from '@/theme';

export type AgendaView = 'day' | 'week' | 'month';
export type AgendaViewTabsProps = { value: AgendaView; onChange: (value: AgendaView) => void };

const views = [
  { value: 'day', label: 'Día' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
] as const;

export function AgendaViewTabs({ value, onChange }: AgendaViewTabsProps) {
  return (
    <View style={styles.section}>
      <View role="group" accessibilityLabel="Vista de agenda" style={styles.controls}>
        {views.map((option) => {
          const selected = value === option.value;
          return (
            <Button
              key={option.value}
              label={option.label}
              variant={selected ? 'primary' : 'outline'}
              accessibilityState={Platform.OS === 'web' ? undefined : { selected }}
              {...(Platform.OS === 'web' ? { 'aria-pressed': selected } : {})}
              onPress={() => onChange(option.value)}
            />
          );
        })}
      </View>
      <Text style={styles.hint}>
        Vista actual: {views.find((option) => option.value === value)?.label}
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: theme.spacing[4] },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[8] },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary },
});
