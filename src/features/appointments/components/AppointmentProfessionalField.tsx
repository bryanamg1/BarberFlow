import { Text, View } from 'react-native';
import { Button, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { theme } from '@/theme';
import { useWorkingMembers } from '../hooks/useWorkingMembers';
import { useAppointmentLifecycle } from '../hooks/useAppointmentLifecycle';

export function AppointmentProfessionalField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string) => void;
}) {
  const result = useWorkingMembers();
  const lifetime = useAppointmentLifecycle('professional-field');
  if (result.status === 'pending') return <LoadingState message="Cargando profesionales…" />;
  if (result.status === 'error')
    return (
      <ErrorState
        message="No se pudieron cargar los profesionales."
        onRetry={() => {
          if (lifetime.isCurrent()) void result.refetch();
        }}
      />
    );
  if (result.status !== 'success' || !lifetime.scope)
    return <EmptyState title="Profesionales no disponibles" />;
  const members = result.data.filter((m) => m.is_active && ['OWNER', 'BARBER'].includes(m.role));
  return (
    <View style={{ gap: theme.spacing[8] }}>
      <Text role="heading" style={{ ...theme.typography.heading, color: theme.colors.textPrimary }}>
        Profesional
      </Text>
      {members.length === 0 && <EmptyState title="No hay profesionales activos" />}
      {members.map((m, i) => {
        const allowed = lifetime.scope!.role === 'OWNER' || m.id === lifetime.scope!.membershipId;
        const label =
          m.id === lifetime.scope!.membershipId
            ? 'Yo'
            : `${m.role === 'OWNER' ? 'Propietario' : 'Barbero'} ${i + 1}`;
        return (
          <Button
            key={m.id}
            label={label}
            accessibilityLabel={`Seleccionar profesional: ${label}`}
            variant={m.id === value ? 'primary' : 'outline'}
            disabled={!allowed || result.isFetching}
            onPress={() => {
              if (allowed && !result.isFetching && lifetime.isCurrent()) onChange(m.id);
            }}
          />
        );
      })}
    </View>
  );
}
