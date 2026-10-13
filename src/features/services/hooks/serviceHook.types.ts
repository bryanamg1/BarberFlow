import type { ServiceRow } from '../repositories/servicesRepository';
import type { UpdateServiceInput } from '../schemas/service.schema';
import type { ServiceListPage, ServiceError } from '../types/service.types';

export type UseServiceDetailResult =
  | { status: 'idle'; data: null; error: null; isFetching: false }
  | { status: 'pending'; data: null; error: null; isFetching: boolean }
  | { status: 'success'; data: ServiceRow; error: null; isFetching: boolean }
  | { status: 'error'; data: null; error: ServiceError; isFetching: boolean };

export type UseServiceListResult =
  | { status: 'idle'; data: null; error: null; isFetching: false }
  | { status: 'pending'; data: null; error: null; isFetching: boolean }
  | { status: 'success'; data: ServiceListPage; error: null; isFetching: boolean }
  | { status: 'error'; data: null; error: ServiceError; isFetching: boolean };

export type ServiceMutationStatus = 'idle' | 'pending' | 'success' | 'error';

export type ServiceMutationResult<TInput> = {
  mutateAsync: (input: TInput) => Promise<ServiceRow>;
  reset: () => void;
} & (
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: ServiceRow; error: null }
  | { status: 'error'; data: null; error: ServiceError }
);

export type UpdateServiceVariables = {
  serviceId: string;
  input: UpdateServiceInput;
};
