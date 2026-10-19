import { StyleSheet } from 'react-native';

import { theme } from '@/theme';

// Approved HD-007 dimensions, confined to this feature (no new global shell).
export const purchaseLayout = { breakpoint: 768, maxWidth: 1200 } as const;
export const purchaseStatusLabel = {
  COMPLETED: 'Completada',
  VOIDED: 'Anulada',
  DRAFT: 'Borrador',
} as const;
export function purchaseDate(value: string | null, timezone: string) {
  if (value === null) return 'Fecha no disponible';
  try {
    return new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return 'Fecha no disponible';
  }
}
export const purchaseStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    width: '100%',
    maxWidth: purchaseLayout.maxWidth,
    alignSelf: 'center',
    padding: theme.spacing[16],
    gap: theme.spacing[24],
  },
  section: { gap: theme.spacing[12] },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
  title: { ...theme.typography.headingSm, color: theme.colors.textPrimary },
  body: { ...theme.typography.body, color: theme.colors.textPrimary, flexShrink: 1 },
  secondary: { ...theme.typography.body, color: theme.colors.textSecondary, flexShrink: 1 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing[8] },
  row: {
    padding: theme.spacing[16],
    gap: theme.spacing[12],
    minHeight: theme.sizing.touchTarget,
    borderWidth: theme.borderWidths.thin,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.surfaceRaised,
  },
  pressed: { backgroundColor: theme.colors.surfaceStrong },
  focused: { borderColor: theme.colors.primary },
  wide: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing[24] },
  column: { flex: 1, gap: theme.spacing[16], minWidth: 0 },
});
