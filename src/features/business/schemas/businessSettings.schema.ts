import { z } from 'zod';

export const businessIdSchema = z.string().refine((value) => value.trim().length > 0);
export const businessProfileSchema = z.object({
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  // SET defines required text, not an ISO allowlist or normalization rule.
  currency_code: z.string(),
  timezone: z.string().refine((value) => {
    if (!value || /^[+-]/.test(value)) return false;
    try {
      new Intl.DateTimeFormat('es', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Ingresa una zona horaria IANA válida.'),
});
export const businessPreferencesSchema = z.object({
  appointment_interval_minutes: z.number().int().positive().max(2147483647),
  default_service_buffer_minutes: z.number().int().nonnegative().max(2147483647),
  allow_overlapping_appointments: z.boolean(),
  low_stock_notifications: z.boolean(),
});
const hasChanges = (value: object) => Object.values(value).some((item) => item !== undefined);
export const updateBusinessProfileSchema = businessProfileSchema.partial().refine(hasChanges);
export const updateBusinessPreferencesSchema = businessPreferencesSchema
  .partial()
  .refine(hasChanges);
export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;
export type BusinessPreferencesInput = z.infer<typeof businessPreferencesSchema>;
export type UpdateBusinessProfileInput = z.infer<typeof updateBusinessProfileSchema>;
export type UpdateBusinessPreferencesInput = z.infer<typeof updateBusinessPreferencesSchema>;
