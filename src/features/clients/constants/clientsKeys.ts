import type { ClientListParams, ClientSearchParams } from '../types/client.types';

export const clientsKeys = {
  all: ['clients'] as const,
  byBusiness: (businessId: string | null) => [...clientsKeys.all, businessId] as const,
  detail: (businessId: string | null, clientId: string | null) =>
    [...clientsKeys.byBusiness(businessId), 'detail', clientId] as const,
  list: (businessId: string | null, params: Required<ClientListParams>) =>
    [
      ...clientsKeys.byBusiness(businessId),
      'list',
      { page: params.page, pageSize: params.pageSize, status: params.status },
    ] as const,
  search: (businessId: string | null, params: Required<ClientSearchParams>) =>
    [
      ...clientsKeys.byBusiness(businessId),
      'search',
      { term: params.term, page: params.page, pageSize: params.pageSize, status: params.status },
    ] as const,
};
