import type { TextStyle } from 'react-native';

export const fontFamilies = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const satisfies Record<string, TextStyle['fontWeight']>;

// Select each static face directly to avoid synthetic weight selection.
export const typography = {
  displayLg: { fontFamily: fontFamilies.bold, fontSize: 32, lineHeight: 38 },
  display: { fontFamily: fontFamilies.bold, fontSize: 28, lineHeight: 34 },
  headingLg: { fontFamily: fontFamilies.bold, fontSize: 24, lineHeight: 30 },
  heading: { fontFamily: fontFamilies.semibold, fontSize: 20, lineHeight: 26 },
  headingSm: { fontFamily: fontFamilies.semibold, fontSize: 18, lineHeight: 24 },
  bodyLg: { fontFamily: fontFamilies.regular, fontSize: 16, lineHeight: 24 },
  body: { fontFamily: fontFamilies.regular, fontSize: 14, lineHeight: 21 },
  bodyMedium: { fontFamily: fontFamilies.medium, fontSize: 14, lineHeight: 21 },
  caption: { fontFamily: fontFamilies.regular, fontSize: 12, lineHeight: 18 },
} as const satisfies Record<string, TextStyle>;
