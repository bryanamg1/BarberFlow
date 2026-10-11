import type { ClientRow } from '../repositories/clientsRepository';
import type { UpdateClientInput } from '../schemas/client.schema';
import type { ClientListPage, ClientServiceError } from '../types/client.types';

export type UseClientDetailResult =
  | { status: 'idle'; data: null; error: null; isFetching: false }
  | { status: 'pending'; data: null; error: null; isFetching: boolean }
  | { status: 'success'; data: ClientRow; error: null; isFetching: boolean }
  | { status: 'error'; data: null; error: ClientServiceError; isFetching: boolean };

export type UseClientsResult =
  | { status: 'idle'; data: null; error: null; isFetching: false }
  | { status: 'pending'; data: null; error: null; isFetching: boolean }
  | { status: 'success'; data: ClientListPage; error: null; isFetching: boolean }
  | { status: 'error'; data: null; error: ClientServiceError; isFetching: boolean };

export type ClientMutationStatus = 'idle' | 'pending' | 'success' | 'error';

export type ClientMutationResult<TInput> = {
  mutateAsync: (input: TInput) => Promise<ClientRow>;
  reset: () => void;
} & (
  | { status: 'idle' | 'pending'; data: null; error: null }
  | { status: 'success'; data: ClientRow; error: null }
  | { status: 'error'; data: null; error: ClientServiceError }
);

export type UpdateClientVariables = {
  clientId: string;
  input: UpdateClientInput;
};
