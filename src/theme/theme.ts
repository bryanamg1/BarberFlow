import { colors, semanticColors } from './colors';
import { radius } from './radius';
import { shadows } from './shadows';
import { sizing } from './sizing';
import { spacing } from './spacing';
import { fontFamily, fontWeights, typography } from './typography';

export const theme = {
  colors,
  semanticColors,
  fontFamily,
  fontWeights,
  typography,
  spacing,
  radius,
  sizing,
  shadows,
} as const;

export type Theme = typeof theme;
