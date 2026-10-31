import { StyleSheet } from 'react-native';
import { theme } from '@/theme';

export const saleStatuses = { DRAFT: 'Borrador', COMPLETED: 'Completada', VOIDED: 'Anulada' };
export function saleDate(value: string | null, timezone: string) {
  if (value === null) return 'No registrada';
  try {
    return new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return 'Fecha no disponible';
  }
}
export const saleStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing[16], gap: theme.spacing[16] },
  section: { gap: theme.spacing[8] },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[8], alignItems: 'center' },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  text: { ...theme.typography.body, color: theme.colors.textPrimary, flexShrink: 1 },
  hint: { ...theme.typography.caption, color: theme.colors.textSecondary },
  row: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing[16],
    borderRadius: theme.radius.card,
    gap: theme.spacing[8],
    borderWidth: theme.borderWidths.thin,
    borderColor: theme.colors.border,
    minHeight: theme.sizing.touchTarget,
  },
  pressed: { backgroundColor: theme.colors.surfaceStrong },
  focused: { borderColor: theme.colors.primary },
});
