import type { ServiceListParams } from '../types/service.types';

export const servicesKeys = {
  all: ['services'] as const,
  byBusiness: (businessId: string | null) => [...servicesKeys.all, businessId] as const,
  detail: (businessId: string | null, serviceId: string | null) =>
    [...servicesKeys.byBusiness(businessId), 'detail', serviceId] as const,
  list: (businessId: string | null, params: Required<ServiceListParams>) =>
    [
      ...servicesKeys.byBusiness(businessId),
      'list',
      { page: params.page, pageSize: params.pageSize, status: params.status },
    ] as const,
};
