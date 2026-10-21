import { createServiceSchema } from '@/features/services/schemas/service.schema';
import type { ServiceRow } from '@/features/services/repositories/servicesRepository';

import {
  createAppointmentItemSchema,
  createAppointmentSchema,
  type CreateAppointmentItemInput,
} from '../schemas/appointment.schema';

type DurationService = Pick<ServiceRow, 'id' | 'business_id' | 'duration_minutes' | 'is_active'>;

// Catalog estimate only. PostgreSQL still resolves authoritative duration at create time.
// bigint keeps even multiple int4 × int4 lines exact before applying the DTO bound.
export function calculateAppointmentDuration(
  businessId: string,
  items: readonly CreateAppointmentItemInput[],
  services: readonly DurationService[],
): bigint | null {
  if (items.length === 0) return null;
  const catalog = new Map(services.map((service) => [service.id, service]));
  let minutes = 0n;
  for (const item of items) {
    if (!createAppointmentItemSchema.safeParse(item).success) return null;
    const service = catalog.get(item.serviceId);
    if (
      !service ||
      service.business_id !== businessId ||
      service.is_active !== true ||
      !createServiceSchema.shape.duration_minutes.safeParse(service.duration_minutes).success
    )
      return null;
    minutes += BigInt(service.duration_minutes) * BigInt(item.quantity);
  }
  return minutes;
}

export function resolveAppointmentDuration(
  base: bigint,
  role: 'OWNER' | 'BARBER',
  override: number | undefined,
): number | null {
  const candidate = override === undefined ? Number(base) : override;
  if (override !== undefined && role !== 'OWNER') return null;
  return createAppointmentSchema.shape.durationOverride.unwrap().safeParse(candidate).success
    ? candidate
    : null;
}
