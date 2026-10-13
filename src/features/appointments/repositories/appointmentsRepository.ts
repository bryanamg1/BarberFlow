import type { PostgrestSingleResponse } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase/client';

import type {
  AppointmentStatusActionInput,
  CreateAppointmentInput,
  RescheduleAppointmentInput,
  UpdateAppointmentNotesInput,
} from '../schemas/appointment.schema';
import type {
  AppointmentAvailabilityInput,
  AppointmentAvailabilitySlot,
  AppointmentDetail,
  AppointmentRange,
  AppointmentRow,
} from '../types/appointment.types';

const columns =
  'id, business_id, client_id, barber_member_id, start_at, end_at, status, notes, created_by, created_at, updated_at';
const lineColumns =
  'id, appointment_id, service_id, service_name_snapshot, unit_price_snapshot, duration_minutes_snapshot, quantity, line_total, created_at';

// IDs scope transport; the normal client, RLS and future RPCs authorize each operation.
// RPC adapters target the approved wire contract; their server implementations are later tickets.
export const appointmentsRepository = {
  listByRange(businessId: string, range: AppointmentRange) {
    return supabase
      .from('appointments')
      .select(columns)
      .eq('business_id', businessId)
      .lt('start_at', range.to)
      .gt('end_at', range.from)
      .order('start_at', { ascending: true })
      .order('id', { ascending: true })
      .overrideTypes<AppointmentRow[], { merge: false }>();
  },

  getById(businessId: string, appointmentId: string) {
    return supabase
      .from('appointments')
      .select(`${columns}, appointment_services(${lineColumns})`)
      .eq('business_id', businessId)
      .eq('id', appointmentId)
      .maybeSingle()
      .overrideTypes<AppointmentDetail, { merge: false }>();
  },

  getAvailability(
    businessId: string,
    input: AppointmentAvailabilityInput,
  ): PromiseLike<PostgrestSingleResponse<AppointmentAvailabilitySlot[]>> {
    return supabase.rpc('get_availability', {
      p_business_id: businessId,
      p_barber_member_id: input.barberMemberId,
      p_date: input.date,
      p_duration_minutes: input.durationMinutes,
      ...(input.excludeAppointmentId !== undefined
        ? { p_exclude_appointment_id: input.excludeAppointmentId }
        : {}),
    });
  },

  create(
    businessId: string,
    input: CreateAppointmentInput,
  ): PromiseLike<PostgrestSingleResponse<AppointmentDetail>> {
    return supabase.rpc('create_appointment_with_services', {
      p_appointment_id: input.requestId,
      p_business_id: businessId,
      p_client_id: input.clientId,
      p_barber_member_id: input.barberMemberId,
      p_start_at: input.startAt,
      p_service_items: input.items.map((item) => ({
        service_id: item.serviceId,
        quantity: item.quantity,
      })),
      ...(input.durationOverride !== undefined
        ? { p_duration_override: input.durationOverride }
        : {}),
      ...(input.notes !== undefined ? { p_notes: input.notes } : {}),
    });
  },

  reschedule(
    businessId: string,
    input: RescheduleAppointmentInput,
  ): PromiseLike<PostgrestSingleResponse<AppointmentRow>> {
    return supabase.rpc('reschedule_appointment', {
      p_business_id: businessId,
      p_appointment_id: input.appointmentId,
      p_barber_member_id: input.barberMemberId,
      p_start_at: input.startAt,
      ...(input.durationOverride !== undefined
        ? { p_duration_override: input.durationOverride }
        : {}),
    });
  },

  updateNotes(
    businessId: string,
    input: UpdateAppointmentNotesInput,
  ): PromiseLike<PostgrestSingleResponse<AppointmentRow>> {
    return supabase.rpc('update_appointment_notes', {
      p_business_id: businessId,
      p_appointment_id: input.appointmentId,
      p_notes: input.notes,
    });
  },

  changeStatus(
    businessId: string,
    input: AppointmentStatusActionInput,
  ): PromiseLike<PostgrestSingleResponse<AppointmentRow>> {
    return supabase.rpc('change_appointment_status', {
      p_business_id: businessId,
      p_appointment_id: input.appointmentId,
      p_status: input.status,
    });
  },
};
