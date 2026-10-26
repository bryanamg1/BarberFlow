import { Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { theme } from '@/theme';
import { mapAppointmentError } from '../services/appointmentErrors';

export function AppointmentConflictFeedback({
  refreshError,
  onRetryReads,
}: {
  refreshError: boolean;
  onRetryReads: () => Promise<void>;
}) {
  return (
    <View style={{ gap: theme.spacing[8] }}>
      <Text
        role="alert"
        aria-live="assertive"
        style={{ ...theme.typography.body, color: theme.colors.textPrimary }}
      >
        {mapAppointmentError('APPOINTMENT_CONFLICT')!.message}
      </Text>
      {refreshError && (
        <>
          <Text role="alert" style={{ ...theme.typography.body, color: theme.colors.textPrimary }}>
            No se pudieron actualizar los horarios. Inténtalo nuevamente antes de elegir otro.
          </Text>
          <Button
            label="Actualizar horarios"
            onPress={() => {
              void onRetryReads();
            }}
          />
        </>
      )}
    </View>
  );
}
