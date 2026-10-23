import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import type { AppointmentRow } from '@/features/appointments/types/appointment.types';

export function agendaContext({
  userId = 'u',
  businessId = 'b',
  membershipId = 'm',
  timezone = 'UTC',
  role = 'OWNER' as 'OWNER' | 'BARBER',
} = {}) {
  jest.mocked(useAuth).mockReturnValue({
    status: 'authenticated',
    user: { id: userId },
    session: {},
    error: null,
  } as ReturnType<typeof useAuth>);
  jest.mocked(useBusiness).mockReturnValue({
    status: 'success',
    isFetching: false,
    error: null,
    data: {
      membershipId,
      role,
      business: { id: businessId, name: 'Demo', timezone, currency_code: 'ARS', is_active: true },
    },
  });
}
export const agendaRow = (
  id = 'a',
  start_at = '2026-10-01T23:30:00Z',
  end_at = '2026-10-02T00:30:00Z',
  extra: Partial<AppointmentRow> = {},
): AppointmentRow => ({
  id,
  business_id: 'b',
  client_id: 'c',
  barber_member_id: 'm',
  start_at,
  end_at,
  status: 'PENDING',
  notes: null,
  created_by: 'u',
  created_at: start_at,
  updated_at: start_at,
  ...extra,
});
