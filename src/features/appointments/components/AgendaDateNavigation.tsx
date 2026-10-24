import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui';
import { theme } from '@/theme';

import { shiftAgendaDate } from '../utils/agendaDateNavigation';
import type { AgendaView } from './AgendaViewTabs';

export type AgendaDateNavigationProps = {
  view: AgendaView;
  date: string;
  onChange: (date: string) => void;
  onToday: () => void;
};

export function AgendaDateNavigation({ view, date, onChange, onToday }: AgendaDateNavigationProps) {
  const candidate = (direction: -1 | 1) => {
    try {
      return shiftAgendaDate(date, view, direction);
    } catch {
      return null;
    }
  };
  const previous = candidate(-1),
    next = candidate(1);
  const unit = view === 'day' ? 'Día' : view === 'week' ? 'Semana' : 'Mes';
  return (
    <View role="group" accessibilityLabel="Navegación de fechas" style={styles.controls}>
      <Button
        label="Anterior"
        accessibilityLabel={`${unit} anterior`}
        variant="outline"
        disabled={previous === null}
        onPress={() => {
          if (previous !== null) onChange(previous);
        }}
      />
      <Button
        label="Hoy"
        accessibilityLabel="Ir a hoy en la zona horaria del negocio"
        variant="secondary"
        onPress={onToday}
      />
      <Button
        label="Siguiente"
        accessibilityLabel={`${unit} siguiente`}
        variant="outline"
        disabled={next === null}
        onPress={() => {
          if (next !== null) onChange(next);
        }}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[8] },
});
