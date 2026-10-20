import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';

export function ExpenseAccess() {
  const business = useBusiness();
  if (business.status === 'pending') return <LoadingState message="Cargando negocio…" />;
  if (business.status === 'error') return <ErrorState message={business.error.message} />;
  return (
    <EmptyState
      title="Gastos no disponibles"
      message="Necesitas una sesión y un negocio con permiso de propietario para gestionar gastos."
    />
  );
}
