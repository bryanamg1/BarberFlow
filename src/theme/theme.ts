import { colors, semanticColors } from './colors';
import { borderWidths } from './borders';
import { radius } from './radius';
import { shadows } from './shadows';
import { sizing } from './sizing';
import { spacing } from './spacing';
import { layout } from './layout';
import { fontFamilies, fontWeights, typography } from './typography';

export const theme = {
  colors,
  semanticColors,
  borderWidths,
  fontFamilies,
  fontWeights,
  typography,
  spacing,
  layout,
  radius,
  sizing,
  shadows,
} as const;

export type Theme = typeof theme;
