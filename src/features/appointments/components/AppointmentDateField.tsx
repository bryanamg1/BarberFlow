import { useEffect, useRef, useState } from 'react';

import { EmptyState, ErrorState, Input, LoadingState } from '@/components/ui';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { businessProfileSchema } from '@/features/business/schemas/businessSettings.schema';

import { appointmentCivilDateSchema } from '../schemas/appointmentDate.schema';

export type AppointmentDateFieldProps = {
  value: string;
  onChange: (value: string) => void;
};

export function AppointmentDateField(props: AppointmentDateFieldProps) {
  const auth = useAuth();
  const business = useBusiness();
  if (auth.status !== 'authenticated') return <EmptyState title="Fecha no disponible" />;
  if (business.status === 'pending') return <LoadingState message="Cargando negocio…" />;
  if (business.status === 'error')
    return <ErrorState message="No se pudo cargar el negocio para seleccionar la fecha." />;
  if (business.status !== 'success') return <EmptyState title="Fecha no disponible" />;
  const timezone = business.data.business.timezone;
  if (!businessProfileSchema.shape.timezone.safeParse(timezone).success)
    return <ErrorState message="La zona horaria del negocio no está disponible." />;
  return (
    <DateField
      key={JSON.stringify([
        auth.user.id,
        business.data.membershipId,
        business.data.business.id,
        business.data.role,
        timezone,
      ])}
      {...props}
      timezone={timezone}
    />
  );
}

function DateField({
  value,
  onChange,
  timezone,
}: AppointmentDateFieldProps & { timezone: string }) {
  const [touched, setTouched] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const invalid =
    (touched || value.length > 0) && !appointmentCivilDateSchema.safeParse(value).success;
  return (
    <Input
      label="Fecha del turno (YYYY-MM-DD)"
      placeholder="AAAA-MM-DD"
      value={value}
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="off"
      helperText={`Zona horaria del negocio: ${timezone}`}
      error={
        invalid
          ? 'Ingresa una fecha real en formato YYYY-MM-DD, entre los años 0001 y 9999.'
          : undefined
      }
      onBlur={() => {
        if (live.current) setTouched(true);
      }}
      onChangeText={(text) => {
        // Preserve controlled text, including incomplete edits. Validation never rewrites a date.
        // The eventual form validates before submit; no startAt or slot is emitted here.
        if (live.current) onChange(text);
      }}
    />
  );
}
