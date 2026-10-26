import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Modal } from '@/components/ui';
import { theme } from '@/theme';
import { useAppointmentLifecycle } from '../hooks/useAppointmentLifecycle';
import { useAppointmentStatusAction } from '../hooks/useAppointmentStatusAction';
import { safeAppointmentHookError } from '../hooks/appointmentQuery';
import type { AppointmentRow } from '../types/appointment.types';
import { canManageAppointment } from '../utils/appointmentEditing';

export function AppointmentActions({ appointment }: { appointment: AppointmentRow }) {
  const lifetime = useAppointmentLifecycle(
    JSON.stringify([
      'appointment-actions',
      appointment.id,
      appointment.status,
      appointment.updated_at,
    ]),
  );
  const mutation = useAppointmentStatusAction();
  const [destination, setDestination] = useState<'CANCELLED' | 'NO_SHOW' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const allowed =
    canManageAppointment(appointment, lifetime.scope) && mutation.status !== 'success';
  async function confirm() {
    if (!allowed || !destination || inFlight.current || !lifetime.isCurrent()) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await mutation.mutateAsync({ appointmentId: appointment.id, status: destination });
      if (lifetime.isCurrent()) {
        setDestination(null);
        setMessage('Estado de la cita actualizado.');
      }
    } catch (error) {
      if (lifetime.isCurrent()) setMessage(safeAppointmentHookError(error).message);
    } finally {
      inFlight.current = false;
      if (lifetime.isCurrent()) setBusy(false);
    }
  }
  return (
    <View style={{ gap: theme.spacing[12] }}>
      {message && (
        <Text
          role={mutation.status === 'error' ? 'alert' : 'status'}
          style={{ ...theme.typography.body, color: theme.colors.textPrimary }}
        >
          {message}
        </Text>
      )}
      {mutation.refreshError && (
        <Button
          label="Actualizar lecturas"
          onPress={() => {
            if (lifetime.isCurrent()) void mutation.retryReads();
          }}
        />
      )}
      {allowed && (
        <>
          <Button
            label="Editar cita"
            disabled={busy}
            onPress={() => {
              if (!inFlight.current && lifetime.isCurrent())
                router.push({
                  pathname: '/appointments/[id]/edit',
                  params: { id: appointment.id },
                });
            }}
          />
          <Button
            label="Cancelar cita"
            variant="danger"
            disabled={busy}
            onPress={() => {
              if (!inFlight.current && lifetime.isCurrent()) {
                mutation.reset();
                setDestination('CANCELLED');
                setMessage(null);
              }
            }}
          />
          <Button
            label="Marcar no asistió"
            variant="outline"
            disabled={busy}
            onPress={() => {
              if (!inFlight.current && lifetime.isCurrent()) {
                mutation.reset();
                setDestination('NO_SHOW');
                setMessage(null);
              }
            }}
          />
        </>
      )}
      <Modal
        visible={allowed && destination !== null}
        title={destination === 'CANCELLED' ? 'Cancelar cita' : 'Marcar no asistió'}
        description="Se actualizará el estado de la cita. No se eliminará su historia ni se registrará un cobro."
        dismissible={!busy}
        onClose={() => {
          if (!inFlight.current && lifetime.isCurrent()) setDestination(null);
        }}
        actions={
          <>
            <Button
              label="Volver sin cambios"
              variant="secondary"
              disabled={busy}
              onPress={() => {
                if (!inFlight.current && lifetime.isCurrent()) setDestination(null);
              }}
            />
            <Button
              label="Confirmar cambio de estado"
              variant="danger"
              loading={busy}
              onPress={() => {
                void confirm();
              }}
            />
          </>
        }
      />
    </View>
  );
}
