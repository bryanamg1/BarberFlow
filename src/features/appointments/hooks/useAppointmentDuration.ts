import { skipToken, useQueries, useQuery } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { businessSettingsKey } from '@/features/business/hooks/useBusinessSettings';
import { businessPreferencesSchema } from '@/features/business/schemas/businessSettings.schema';
import { businessSettingsService } from '@/features/business/services/businessSettingsService';
import { servicesKeys } from '@/features/services/constants/servicesKeys';
import { servicesService } from '@/features/services/services/servicesService';

import {
  createAppointmentItemSchema,
  type CreateAppointmentItemInput,
} from '../schemas/appointment.schema';
import { calculateAppointmentDuration } from '../utils/appointmentDuration';

export function useAppointmentDuration(items: CreateAppointmentItemInput[]) {
  const auth = useAuth();
  const business = useBusiness();
  const scope =
    auth.status === 'authenticated' && business.status === 'success'
      ? {
          businessId: business.data.business.id,
          membershipId: business.data.membershipId,
          userId: auth.user.id,
          role: business.data.role,
        }
      : null;
  const valid =
    items.length > 0 && items.every((item) => createAppointmentItemSchema.safeParse(item).success);
  const ids = valid ? [...new Set(items.map((item) => item.serviceId))] : [];
  const services = useQueries({
    queries:
      scope === null
        ? []
        : ids.map((id) => ({
            queryKey: [...servicesKeys.detail(scope.businessId, id), scope],
            retry: false,
            queryFn: async () => {
              const result = await servicesService.getById(scope.businessId, id);
              if (result.error) throw result.error;
              if (result.data.id !== id || result.data.business_id !== scope.businessId)
                throw new Error('Unavailable service');
              return result.data;
            },
          })),
  });
  const settings = useQuery({
    queryKey: businessSettingsKey(
      scope === null
        ? null
        : {
            businessId: scope.businessId,
            membershipId: scope.membershipId,
            userId: scope.userId,
          },
    ),
    enabled: scope !== null && valid,
    retry: false,
    queryFn:
      scope === null
        ? skipToken
        : async () => {
            const result = await businessSettingsService.get(scope.businessId);
            if (result.error) throw result.error;
            if (result.data.preferences.business_id !== scope.businessId)
              throw new Error('Unavailable settings');
            return result.data;
          },
  });
  const retry = () => {
    if (!scope || !valid) return;
    void settings.refetch();
    for (const service of services) void service.refetch();
  };
  const controls = { scope, retry };
  if (scope === null) return { ...controls, status: 'idle' as const };
  if (items.length === 0) return { ...controls, status: 'empty' as const };
  if (!valid) return { ...controls, status: 'error' as const };
  if (settings.isError || services.some((service) => service.isError))
    return { ...controls, status: 'error' as const };
  if (
    !settings.isSuccess ||
    services.some((service) => !service.isSuccess || service.isFetching) ||
    settings.isFetching
  )
    return { ...controls, status: 'pending' as const };
  const base = calculateAppointmentDuration(
    scope.businessId,
    items,
    services.flatMap((service) => (service.data ? [service.data] : [])),
  );
  const buffer = businessPreferencesSchema.shape.default_service_buffer_minutes.safeParse(
    settings.data.preferences.default_service_buffer_minutes,
  );
  if (base === null || !buffer.success) return { ...controls, status: 'error' as const };
  return {
    ...controls,
    scope,
    status: 'success' as const,
    baseDurationMinutes: base,
    bufferAfterMinutes: buffer.data,
  };
}
