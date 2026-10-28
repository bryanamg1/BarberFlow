import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';

import { useAppointmentLifecycle } from '@/features/appointments/hooks/useAppointmentLifecycle';
import type { AppointmentServiceError } from '@/features/appointments/services/appointmentErrors';
import type { AppointmentRow } from '@/features/appointments/types/appointment.types';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { businessProfileSchema } from '@/features/business/schemas/businessSettings.schema';

import { homeKeys } from '../constants/homeKeys';
import { homeService } from '../services/homeService';
import type { HomeNextAppointmentResult } from '../types/home.types';

export function useNextAppointment(): HomeNextAppointmentResult {
  const business = useBusiness();
  const timezone = business.status === 'success' ? business.data.business.timezone : null;
  const lifecycle = useAppointmentLifecycle(
    JSON.stringify(['home-next', timezone, business.isFetching]),
  );
  const enabled =
    lifecycle.scope !== null &&
    business.status === 'success' &&
    !business.isFetching &&
    businessProfileSchema.shape.timezone.safeParse(timezone).success;
  const scope = enabled ? lifecycle.scope : null;
  const key = homeKeys.nextAppointment(scope, timezone);
  const capturedKey = JSON.stringify(key);
  const client = useQueryClient();
  useLayoutEffect(
    () => () => {
      void client.cancelQueries({ queryKey: JSON.parse(capturedKey), exact: true });
    },
    [client, capturedKey],
  );
  const query = useQuery<AppointmentRow | null, AppointmentServiceError>({
    queryKey: key,
    enabled,
    retry: false,
    // Eligibility is evaluated by DB now, so a new activation refreshes this reader.
    staleTime: 0,
    queryFn: !scope
      ? skipToken
      : async ({ signal }) => {
          if (signal.aborted || !lifecycle.isCurrent())
            throw { code: 'APPOINTMENT_ACCESS_DENIED', message: 'El turno no está disponible.' };
          const result = await homeService.getNextAppointment(scope.businessId, signal);
          if (signal.aborted || !lifecycle.isCurrent())
            throw { code: 'APPOINTMENT_ACCESS_DENIED', message: 'El turno no está disponible.' };
          if (result.error) throw result.error;
          if (
            result.data &&
            scope.role === 'BARBER' &&
            result.data.barber_member_id !== scope.membershipId
          )
            throw { code: 'INVALID_APPOINTMENT', message: 'El turno no está disponible.' };
          return result.data;
        },
  });
  if (!enabled) return { status: 'unavailable' };
  if (query.isError)
    return { status: query.error.code === 'INVALID_APPOINTMENT' ? 'unavailable' : 'error' };
  if (query.isFetching || !query.isSuccess) return { status: 'loading' };
  return { status: 'success', data: query.data };
}
