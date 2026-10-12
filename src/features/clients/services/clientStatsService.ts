import { clientStatsRepository } from '../repositories/clientStatsRepository';
import type { ClientErrorCode } from '../types/client.types';
import type { ClientStatsResult } from '../types/clientStats.types';
import { clientError } from '../utils/clientErrors';

type ClientStatsRow = {
  total_appointments: string;
  completed_visits: string;
  no_show_count: string;
  last_visit_at: string | null;
  next_appointment_at: string | null;
  total_spent: string | null;
};

function count(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
}

function instant(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      Number.isFinite(Date.parse(value)))
  );
}

function validRow(value: unknown): value is ClientStatsRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    count(row.total_appointments) &&
    count(row.completed_visits) &&
    count(row.no_show_count) &&
    instant(row.last_visit_at) &&
    instant(row.next_appointment_at) &&
    (row.total_spent === null ||
      (typeof row.total_spent === 'string' && /^(0|[1-9]\d*)\.\d{2}$/.test(row.total_spent)))
  );
}

function failure(code: ClientErrorCode): ClientStatsResult {
  return { data: null, error: clientError(code) };
}

export const clientStatsService = {
  async getByClient(businessId: string, clientId: string): Promise<ClientStatsResult> {
    try {
      const result = await clientStatsRepository.getByClient(businessId, clientId);
      if (result.error !== null) {
        if (result.status === 0) return failure('NETWORK_ERROR');
        if (result.status === 401 || result.status === 403 || result.error.code === '42501') {
          return failure('CLIENT_ACCESS_DENIED');
        }
        if (result.error.code === 'P0002') return failure('CLIENT_NOT_FOUND');
        return failure('UNKNOWN_ERROR');
      }
      const data: unknown = result.data;
      if (!Array.isArray(data) || data.length !== 1 || !validRow(data[0])) {
        return failure('UNKNOWN_ERROR');
      }
      const row = data[0];
      return {
        data: {
          totalAppointments: row.total_appointments,
          completedVisits: row.completed_visits,
          noShowCount: row.no_show_count,
          lastVisitAt: row.last_visit_at,
          nextAppointmentAt: row.next_appointment_at,
          totalSpent: row.total_spent,
        },
        error: null,
      };
    } catch {
      return failure('UNKNOWN_ERROR');
    }
  },
};
