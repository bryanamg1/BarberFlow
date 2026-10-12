import type { ClientServiceError } from './client.types';

// Decimal strings preserve PostgreSQL bigint/numeric precision across JSON.
export type ClientStats = {
  totalAppointments: string;
  completedVisits: string;
  noShowCount: string;
  lastVisitAt: string | null;
  nextAppointmentAt: string | null;
  totalSpent: string | null;
};

export type ClientStatsResult =
  { data: ClientStats; error: null } | { data: null; error: ClientServiceError };

export type UseClientStatsResult =
  | { status: 'idle'; data: null; error: null; isFetching: boolean }
  | { status: 'pending'; data: null; error: null; isFetching: boolean }
  | { status: 'success'; data: ClientStats; error: null; isFetching: boolean }
  | { status: 'error'; data: null; error: ClientServiceError; isFetching: boolean };
