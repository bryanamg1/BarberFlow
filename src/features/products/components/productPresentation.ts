import { Platform, StyleSheet } from 'react-native';
import { theme } from '@/theme';
import type { ProductCategoryBatchResult } from '../hooks/useProductCategoriesByIds';

export function productCategoryLabel(
  id: string | null,
  result: ProductCategoryBatchResult,
): string {
  if (id === null) return 'Sin categoría';
  if (result.status === 'pending') return 'Cargando categoría…';
  const category =
    result.status === 'success' ? result.data.find((row) => row.id === id) : undefined;
  return category
    ? `${category.name}${category.is_active ? '' : ' (archivada)'}`
    : 'Categoría no disponible';
}
export const productStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    padding: theme.spacing[16],
    gap: theme.spacing[24],
    width: '100%',
    alignSelf: 'center',
  },
  section: { gap: theme.spacing[16] },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary, flexShrink: 1 },
  name: { ...theme.typography.bodyLg, color: theme.colors.textPrimary, flexShrink: 1 },
  text: { ...theme.typography.body, color: theme.colors.textSecondary, flexShrink: 1 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing[8] },
  row: {
    minHeight: theme.sizing.touchTarget,
    padding: theme.spacing[16],
    gap: theme.spacing[12],
    borderWidth: theme.borderWidths.thin,
    borderRadius: theme.radius.card,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceRaised,
  },
  pressed: { backgroundColor: theme.colors.surfaceStrong },
  focused: {
    borderColor: theme.colors.primary,
    ...Platform.select({
      web: {
        outlineStyle: 'solid',
        outlineColor: theme.colors.primary,
        outlineWidth: theme.borderWidths.thin,
        outlineOffset: theme.spacing[4],
      },
    }),
  },
});
