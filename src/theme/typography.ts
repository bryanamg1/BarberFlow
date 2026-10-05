import type { TextStyle } from 'react-native';

// Font registration/loading belongs to BF-025; these tokens only declare the family.
export const fontFamily = 'Inter';

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const satisfies Record<string, TextStyle['fontWeight']>;

export const typography = {
  displayLg: { fontFamily, fontSize: 32, lineHeight: 38, fontWeight: fontWeights.bold },
  display: { fontFamily, fontSize: 28, lineHeight: 34, fontWeight: fontWeights.bold },
  headingLg: { fontFamily, fontSize: 24, lineHeight: 30, fontWeight: fontWeights.bold },
  heading: { fontFamily, fontSize: 20, lineHeight: 26, fontWeight: fontWeights.semibold },
  headingSm: { fontFamily, fontSize: 18, lineHeight: 24, fontWeight: fontWeights.semibold },
  bodyLg: { fontFamily, fontSize: 16, lineHeight: 24, fontWeight: fontWeights.regular },
  body: { fontFamily, fontSize: 14, lineHeight: 21, fontWeight: fontWeights.regular },
  bodyMedium: { fontFamily, fontSize: 14, lineHeight: 21, fontWeight: fontWeights.medium },
  caption: { fontFamily, fontSize: 12, lineHeight: 18, fontWeight: fontWeights.regular },
} as const satisfies Record<string, TextStyle>;
