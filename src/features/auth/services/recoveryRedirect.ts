import { Platform } from 'react-native';

import { getWebRecoveryRedirectUrl } from '@/lib/env';

export function recoveryRedirectUrl(): string {
  return Platform.OS === 'web' ? getWebRecoveryRedirectUrl() : 'barberflow://auth/recovery';
}
