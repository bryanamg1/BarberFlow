import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { businessProfileSchema } from '@/features/business/schemas/businessSettings.schema';
import { theme } from '@/theme';
import { formatCatalogPrice } from '@/utils/formatMoney';

import { appointmentStatusLabels } from '../components/AppointmentCard';
import { AppointmentActions } from '../components/AppointmentActions';
import { useAppointmentClient } from '../hooks/useAppointmentClient';
import { useAppointmentDetail } from '../hooks/useAppointmentDetail';
import { usableAppointmentId, useAppointmentLifecycle } from '../hooks/useAppointmentLifecycle';
import { useWorkingMembers } from '../hooks/useWorkingMembers';
import { mapAppointmentError } from '../services/appointmentErrors';
import type { AppointmentDetail } from '../types/appointment.types';
import { agendaAppointmentRange } from '../utils/agendaCalendar';

export function AppointmentDetailScreen({ appointmentId }: { appointmentId: string | null }) {
  const business = useBusiness();
  const lifetime = useAppointmentLifecycle(JSON.stringify(['appointment-screen', appointmentId]));
  const timezone = business.status === 'success' ? business.data.business.timezone : null;
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Detalle de cita
        </Text>
        <Button
          label="Volver a agenda"
          variant="secondary"
          onPress={() => {
            if (lifetime.isCurrent()) router.replace('/agenda');
          }}
        />
        {business.status === 'pending' ? (
          <LoadingState message="Cargando negocio…" />
        ) : business.status === 'error' ? (
          <ErrorState message="No se pudo cargar el negocio." />
        ) : !lifetime.scope || business.status !== 'success' ? (
          <EmptyState title="Cita no disponible" />
        ) : !usableAppointmentId(appointmentId) ? (
          <EmptyState title="Cita no encontrada" />
        ) : timezone === null ||
          !businessProfileSchema.shape.timezone.safeParse(timezone).success ? (
          <ErrorState message="La zona horaria del negocio no está disponible." />
        ) : (
          <Detail
            key={JSON.stringify([lifetime.scope, appointmentId, timezone])}
            appointmentId={appointmentId}
            businessId={lifetime.scope.businessId}
            timezone={timezone}
            currency={business.data.business.currency_code}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
function Detail({
  appointmentId,
  businessId,
  timezone,
  currency,
}: {
  appointmentId: string;
  businessId: string;
  timezone: string;
  currency: string;
}) {
  const result = useAppointmentDetail(appointmentId);
  if (result.status === 'idle') return <EmptyState title="Cita no disponible" />;
  if (result.status === 'pending') return <LoadingState message="Cargando cita…" />;
  if (result.status === 'error')
    return result.error.code === 'APPOINTMENT_NOT_FOUND' ? (
      <EmptyState title="Cita no encontrada" />
    ) : (
      <ErrorState
        message={mapAppointmentError(result.error.code)?.message ?? 'No se pudo cargar la cita.'}
        retrying={result.isFetching}
        onRetry={() => {
          void result.refetch();
        }}
      />
    );
  if (result.status !== 'success') return <EmptyState title="Cita no disponible" />;
  if (result.data.id !== appointmentId || result.data.business_id !== businessId)
    return <EmptyState title="Cita no encontrada" />;
  return <Information appointment={result.data} timezone={timezone} currency={currency} />;
}
function Information({
  appointment,
  timezone,
  currency,
}: {
  appointment: AppointmentDetail;
  timezone: string;
  currency: string;
}) {
  const client = useAppointmentClient(appointment.client_id);
  const directory = useWorkingMembers();
  const lifetime = useAppointmentLifecycle(
    JSON.stringify(['appointment-information', appointment.id]),
  );
  const memberIndex =
    directory.status === 'success'
      ? directory.data.findIndex((row) => row.id === appointment.barber_member_id)
      : -1;
  const member =
    directory.status === 'success' && memberIndex >= 0 ? directory.data[memberIndex] : null;
  const memberLabel = member
    ? member.id === lifetime.scope?.membershipId
      ? 'Yo'
      : `${member.role === 'OWNER' ? 'Propietario' : 'Barbero'} ${memberIndex + 1}`
    : 'Profesional no disponible';
  const checkoutAllowed =
    lifetime.scope?.role === 'OWNER' &&
    ['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(appointment.status);
  return (
    <View style={styles.section}>
      <Card style={styles.section}>
        <Text
          style={[
            styles.text,
            { color: theme.semanticColors.appointmentStatus[appointment.status] },
          ]}
        >
          Estado: {appointmentStatusLabels[appointment.status]}
        </Text>
        <Text style={styles.text}>
          Fecha y hora ({timezone}): {agendaAppointmentRange(appointment, timezone)}
        </Text>
        {client.status === 'pending' ? (
          <LoadingState message="Cargando cliente…" />
        ) : client.status === 'success' ? (
          <Text style={styles.text}>
            Cliente:{' '}
            {[client.data.first_name, client.data.last_name]
              .filter((value) => value !== null)
              .join(' ')}
          </Text>
        ) : (
          <Text style={styles.text}>Cliente no disponible</Text>
        )}
        {client.status === 'error' && client.error.code !== 'APPOINTMENT_NOT_FOUND' && (
          <ErrorState
            message="No se pudo cargar el cliente."
            onRetry={() => {
              void client.refetch();
            }}
          />
        )}
        {directory.status === 'pending' ? (
          <LoadingState message="Cargando profesional…" />
        ) : (
          <Text style={styles.text}>Profesional: {memberLabel}</Text>
        )}
        {directory.status === 'error' && (
          <ErrorState
            message="No se pudo cargar el profesional."
            onRetry={() => {
              void directory.refetch();
            }}
          />
        )}
        <Text style={styles.text}>Notas: {appointment.notes ?? 'Sin notas'}</Text>
      </Card>
      <Text role="heading" style={styles.heading}>
        Servicios registrados
      </Text>
      {appointment.appointment_services.length === 0 ? (
        <EmptyState title="No hay servicios visibles" />
      ) : (
        appointment.appointment_services
          .filter((line) => line.appointment_id === appointment.id)
          .map((line) => (
            <Card key={line.id} style={styles.section}>
              <Text style={styles.text}>{line.service_name_snapshot}</Text>
              <Text style={styles.text}>Cantidad: {line.quantity}</Text>
              <Text style={styles.text}>
                Duración unitaria histórica: {line.duration_minutes_snapshot} minutos
              </Text>
              <Text style={styles.text}>
                Precio unitario histórico: {formatCatalogPrice(line.unit_price_snapshot, currency)}
              </Text>
              <Text style={styles.text}>
                Importe registrado: {formatCatalogPrice(line.line_total, currency)}
              </Text>
            </Card>
          ))
      )}
      {checkoutAllowed && (
        <Button
          label="Ir a cobrar"
          accessibilityLabel="Ir al checkout de esta cita"
          onPress={() => {
            if (lifetime.isCurrent())
              router.push({ pathname: '/sales/new', params: { appointmentId: appointment.id } });
          }}
        />
      )}
      <AppointmentActions appointment={appointment} />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing[16], gap: theme.spacing[16] },
  section: { gap: theme.spacing[12], minWidth: 0 },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  text: { ...theme.typography.body, color: theme.colors.textPrimary, flexShrink: 1 },
});
