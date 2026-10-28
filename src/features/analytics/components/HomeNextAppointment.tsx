import { StyleSheet, Text, View } from 'react-native';

import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useAuth } from '@/features/auth/context/AuthContext';
import {
  agendaAppointmentRange,
  agendaDateLabel,
  businessCivilDate,
} from '@/features/appointments/utils/agendaCalendar';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { businessProfileSchema } from '@/features/business/schemas/businessSettings.schema';
import { theme } from '@/theme';

import { homeNextAppointmentSchema } from '../schemas/homeNextAppointment.schema';
import type { HomeNextAppointmentResult } from '../types/home.types';

export type HomeNextAppointmentProps = {
  result: HomeNextAppointmentResult;
  onOpen: (appointmentId: string) => void;
};

export function HomeNextAppointment({ result, onOpen }: HomeNextAppointmentProps) {
  const auth = useAuth();
  const business = useBusiness();
  const unavailable = <EmptyState title="Próximo turno no disponible" />;
  if (
    auth.status !== 'authenticated' ||
    business.status !== 'success' ||
    business.isFetching ||
    !['OWNER', 'BARBER'].includes(business.data.role) ||
    !businessProfileSchema.shape.timezone.safeParse(business.data.business.timezone).success
  )
    return unavailable;
  if (result.status === 'loading') return <LoadingState message="Cargando próximo turno…" />;
  if (result.status === 'error')
    return <ErrorState message="No pudimos cargar el próximo turno." />;
  if (result.status !== 'success') return unavailable;
  if (result.data === null) return <EmptyState title="No hay próximos turnos" />;
  const parsed = homeNextAppointmentSchema.safeParse(result.data);
  if (
    !parsed.success ||
    parsed.data.business_id !== business.data.business.id ||
    (business.data.role === 'BARBER' && parsed.data.barber_member_id !== business.data.membershipId)
  )
    return unavailable;
  const appointment = parsed.data;
  const timezone = business.data.business.timezone;
  const label = appointment.status === 'PENDING' ? 'Pendiente' : 'Confirmado';
  return (
    <Card>
      <View style={styles.content}>
        <Text role="heading" style={styles.heading}>
          Próximo turno
        </Text>
        <Text style={styles.text}>
          {agendaDateLabel(businessCivilDate(Date.parse(appointment.start_at), timezone))}
        </Text>
        <Text style={styles.text}>{agendaAppointmentRange(appointment, timezone)}</Text>
        <Badge label={label} tone={appointment.status === 'PENDING' ? 'warning' : 'primary'} />
        <Button label="Ver detalle" onPress={() => onOpen(appointment.id)} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: theme.spacing[12] },
  heading: { ...theme.typography.heading, color: theme.colors.textPrimary },
  text: { ...theme.typography.body, color: theme.colors.textPrimary },
});
