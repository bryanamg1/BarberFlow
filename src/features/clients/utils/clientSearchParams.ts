import type { ClientSearchParams } from '../types/client.types';
import { normalizeClientListParams } from './clientListParams';

export function normalizeClientSearchParams(
  params: ClientSearchParams,
): Required<ClientSearchParams> | null {
  const pagination = normalizeClientListParams(params);
  if (pagination === null || typeof params.term !== 'string') return null;
  return { ...pagination, term: params.term.trim() };
}
