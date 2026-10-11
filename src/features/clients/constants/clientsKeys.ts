export const clientsKeys = {
  all: ['clients'] as const,
  byBusiness: (businessId: string | null) => [...clientsKeys.all, businessId] as const,
  detail: (businessId: string | null, clientId: string | null) =>
    [...clientsKeys.byBusiness(businessId), 'detail', clientId] as const,
};
