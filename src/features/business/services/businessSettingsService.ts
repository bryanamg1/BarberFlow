import { businessConfigurationRepository } from '../repositories/businessConfigurationRepository';
import { businessSettingsRepository } from '../repositories/businessSettingsRepository';
import {
  businessIdSchema,
  updateBusinessProfileSchema,
  updateBusinessPreferencesSchema,
  type UpdateBusinessProfileInput,
  type UpdateBusinessPreferencesInput,
} from '../schemas/businessSettings.schema';

const messages = {
  INVALID_SETTINGS: 'Revisa los datos de configuración.',
  BUSINESS_CURRENCY_LOCKED: 'La moneda no puede cambiar después de registrar actividad financiera.',
  BUSINESS_ACCESS_DENIED: 'No tienes acceso a esta configuración.',
  SETTINGS_NOT_FOUND: 'La configuración no está disponible.',
  NETWORK_ERROR: 'No se pudo conectar. Inténtalo nuevamente.',
  UNKNOWN_ERROR: 'No se pudo guardar o cargar la configuración. Inténtalo nuevamente.',
} as const;
export type SettingsError = { code: keyof typeof messages; message: string };
export type SettingsResult<T> = { data: T; error: null } | { data: null; error: SettingsError };
export const settingsError = (code: keyof typeof messages): SettingsError => ({
  code,
  message: messages[code],
});
export async function settingsOperation<T>(
  operation: () => PromiseLike<{
    data: T | null;
    error: { code: string } | null;
    status: number;
  }>,
): Promise<SettingsResult<T>> {
  try {
    const result = await operation();
    if (result.error) {
      const code =
        result.status === 0
          ? 'NETWORK_ERROR'
          : result.error.code === 'P0272'
            ? 'BUSINESS_CURRENCY_LOCKED'
            : result.status === 401 || result.status === 403 || result.error.code === '42501'
              ? 'BUSINESS_ACCESS_DENIED'
              : 'UNKNOWN_ERROR';
      return { data: null, error: settingsError(code) };
    }
    return result.data === null
      ? { data: null, error: settingsError('SETTINGS_NOT_FOUND') }
      : { data: result.data, error: null };
  } catch {
    return { data: null, error: settingsError('UNKNOWN_ERROR') };
  }
}
export const businessSettingsService = {
  async get(businessId: string) {
    if (!businessIdSchema.safeParse(businessId).success)
      return { data: null, error: settingsError('BUSINESS_ACCESS_DENIED') } as const;
    const [profile, preferences] = await Promise.all([
      settingsOperation(() => businessConfigurationRepository.getByBusinessId(businessId)),
      settingsOperation(() => businessSettingsRepository.getByBusinessId(businessId)),
    ]);
    if (profile.error) return { data: null, error: profile.error } as const;
    if (preferences.error) return { data: null, error: preferences.error } as const;
    return { data: { profile: profile.data, preferences: preferences.data }, error: null } as const;
  },
  updateProfile(businessId: string, input: UpdateBusinessProfileInput) {
    const parsed = updateBusinessProfileSchema.safeParse(input);
    if (!businessIdSchema.safeParse(businessId).success || !parsed.success)
      return Promise.resolve({ data: null, error: settingsError('INVALID_SETTINGS') } as const);
    return settingsOperation(() => businessConfigurationRepository.update(businessId, parsed.data));
  },
  updatePreferences(businessId: string, input: UpdateBusinessPreferencesInput) {
    const parsed = updateBusinessPreferencesSchema.safeParse(input);
    if (!businessIdSchema.safeParse(businessId).success || !parsed.success)
      return Promise.resolve({ data: null, error: settingsError('INVALID_SETTINGS') } as const);
    return settingsOperation(() => businessSettingsRepository.update(businessId, parsed.data));
  },
};
