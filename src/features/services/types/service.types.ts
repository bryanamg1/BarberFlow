import type { ServiceRow } from '../repositories/servicesRepository';

export type ServiceErrorCode =
  'SERVICE_NOT_FOUND' | 'SERVICE_ACCESS_DENIED' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR';

export type ServiceError = { code: ServiceErrorCode; message: string };

export type ServiceResult = { data: ServiceRow; error: null } | { data: null; error: ServiceError };

export type ServiceListParams = {
  page?: number;
  pageSize?: number;
  status?: 'active' | 'inactive' | 'all';
};

export type ServiceListPage = {
  items: ServiceRow[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
};

export type ServiceListResult =
  { data: ServiceListPage; error: null } | { data: null; error: ServiceError };
