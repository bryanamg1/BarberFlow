import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { useBusiness } from '@/features/business/context/BusinessContext';

export function PurchaseAccess() {
  const business = useBusiness();
  if (business.status === 'pending') return <LoadingState message="Cargando negocio…" />;
  if (business.status === 'error') return <ErrorState message={business.error.message} />;
  return (
    <EmptyState
      title="Acceso restringido"
      message="Necesitas una sesión y un negocio con permiso de propietario para ver compras."
    />
  );
}
