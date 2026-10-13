import { z } from 'zod';
import type { PostgrestSingleResponse } from '@supabase/supabase-js';

import {
  businessHoursRepository,
  type BusinessHour,
} from '../repositories/businessHoursRepository';
import {
  businessHourInputSchema,
  businessHoursInputSchema,
  type BusinessHoursInput,
} from '../schemas/businessHours.schema';
import { businessIdSchema } from '../schemas/businessSettings.schema';
import { settingsError, settingsOperation } from './businessSettingsService';

const rowsSchema = z
  .array(businessHourInputSchema.safeExtend({ id: z.string(), business_id: z.string() }))
  .max(7)
  .refine((rows) => new Set(rows.map((row) => row.day_of_week)).size === rows.length);
async function readRows(
  businessId: string,
  operation: () => PromiseLike<PostgrestSingleResponse<BusinessHour[]>>,
  requireWeek = false,
) {
  const result = await settingsOperation(operation);
  if (result.error) return result;
  const parsed = rowsSchema.safeParse(result.data);
  if (
    !parsed.success ||
    parsed.data.some((row) => row.business_id !== businessId) ||
    (requireWeek && parsed.data.length !== 7)
  )
    return { data: null, error: settingsError('UNKNOWN_ERROR') } as const;
  return { data: parsed.data, error: null } as const;
}
export const businessHoursService = {
  get(businessId: string) {
    if (!businessIdSchema.safeParse(businessId).success)
      return Promise.resolve({
        data: null,
        error: settingsError('BUSINESS_ACCESS_DENIED'),
      } as const);
    return readRows(businessId, () => businessHoursRepository.getByBusinessId(businessId));
  },
  save(businessId: string, input: BusinessHoursInput) {
    const parsed = businessHoursInputSchema.safeParse(input);
    if (!businessIdSchema.safeParse(businessId).success || !parsed.success)
      return Promise.resolve({ data: null, error: settingsError('INVALID_SETTINGS') } as const);
    return readRows(
      businessId,
      () => businessHoursRepository.upsert(businessId, parsed.data),
      true,
    );
  },
};
