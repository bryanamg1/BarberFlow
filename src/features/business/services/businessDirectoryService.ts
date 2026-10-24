import { z } from 'zod';

import { businessDirectoryRepository } from '../repositories/businessDirectoryRepository';
import { businessIdSchema } from '../schemas/businessSettings.schema';
import { settingsError, settingsOperation } from './businessSettingsService';

const membersSchema = z.array(
  z.object({
    id: businessIdSchema,
    role: z.enum(['OWNER', 'BARBER']),
    is_active: z.literal(true),
  }),
);
export const businessDirectoryService = {
  async listWorkingMembers(businessId: string, membershipId?: string) {
    if (
      !businessIdSchema.safeParse(businessId).success ||
      (membershipId !== undefined && !businessIdSchema.safeParse(membershipId).success)
    )
      return { data: null, error: settingsError('BUSINESS_ACCESS_DENIED') } as const;
    const result = await settingsOperation(() =>
      businessDirectoryRepository.listWorkingMembers(businessId, membershipId),
    );
    if (result.error) return result;
    const parsed = membersSchema.safeParse(result.data);
    if (
      !parsed.success ||
      (membershipId !== undefined && parsed.data.some((row) => row.id !== membershipId))
    )
      return { data: null, error: settingsError('UNKNOWN_ERROR') } as const;
    return { data: parsed.data, error: null } as const;
  },
};
