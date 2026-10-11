import type { ClientRow } from '../repositories/clientsRepository';

export type ClientErrorCode =
  'CLIENT_NOT_FOUND' | 'NETWORK_ERROR' | 'CLIENT_ACCESS_DENIED' | 'UNKNOWN_ERROR';

export type ClientServiceError = {
  code: ClientErrorCode;
  message: string;
};

export type ClientResult =
  { data: ClientRow; error: null } | { data: null; error: ClientServiceError };

export type ClientListStatus = 'active' | 'inactive' | 'all';

export type ClientListParams = {
  page?: number;
  pageSize?: number;
  status?: ClientListStatus;
};

export type ClientListPage = {
  items: ClientRow[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
};

export type ClientListResult =
  { data: ClientListPage; error: null } | { data: null; error: ClientServiceError };
