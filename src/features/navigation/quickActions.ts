export type QuickActionId =
  'NEW_APPOINTMENT' | 'NEW_CLIENT' | 'NEW_SALE' | 'NEW_EXPENSE' | 'NEW_PURCHASE';

export const quickActions = [
  { id: 'NEW_APPOINTMENT', label: 'Nuevo turno', roles: ['OWNER', 'BARBER'] },
  { id: 'NEW_CLIENT', label: 'Nuevo cliente', roles: ['OWNER', 'BARBER'] },
  { id: 'NEW_SALE', label: 'Nueva venta', roles: ['OWNER'] },
  { id: 'NEW_EXPENSE', label: 'Nuevo gasto', roles: ['OWNER'] },
  { id: 'NEW_PURCHASE', label: 'Ingresar mercadería', roles: ['OWNER'] },
] as const satisfies readonly {
  id: QuickActionId;
  label: string;
  roles: readonly ('OWNER' | 'BARBER')[];
}[];

export function isQuickActionAllowed(
  actionId: unknown,
  role: 'OWNER' | 'BARBER',
): actionId is QuickActionId {
  return quickActions.some(
    (action) => action.id === actionId && action.roles.some((allowedRole) => allowedRole === role),
  );
}
