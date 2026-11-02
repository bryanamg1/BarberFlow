import { useWindowDimensions } from 'react-native';

import { theme } from '@/theme';

export function useWideLayout(): boolean {
  return useWindowDimensions().width >= theme.layout.wide;
}
