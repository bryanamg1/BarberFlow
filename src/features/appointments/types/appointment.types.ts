import type { AppointmentRangeInput, CreateAppointmentInput } from '../schemas/appointment.schema';

export type {
  CreateAppointmentInput,
  CreateAppointmentItemInput,
} from '../schemas/appointment.schema';

// Database values only: this tuple does not define presentation or transition order.
export const APPOINTMENT_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

// Timestamptz values stay UTC ISO instant strings; no local-date conversion in row types.
export type AppointmentRow = {
  id: string;
  business_id: string;
  client_id: string;
  barber_member_id: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type AppointmentServiceRow = {
  id: string;
  appointment_id: string;
  service_id: string | null;
  service_name_snapshot: string;
  unit_price_snapshot: number;
  duration_minutes_snapshot: number;
  quantity: number;
  line_total: number;
  created_at: string;
};

// A context adapter supplies businessId; this identifier is not authorization.
export type CreateAppointmentRequest = CreateAppointmentInput & {
  businessId: string;
};

// UTC instant endpoints, half-open [from, to); civil/timezone conversion is a separate concern.
export type AppointmentRange = AppointmentRangeInput;

// BF147 defines domain error codes/mapping; BF140 only fixes the safe result envelope.
export type AppointmentError<TCode extends string> = {
  code: TCode;
  message: string;
};

export type AppointmentResult<TData, TCode extends string> =
  { data: TData; error: null } | { data: null; error: AppointmentError<TCode> };
