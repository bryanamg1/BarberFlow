import type { ClientListParams } from '../types/client.types';

export function normalizeClientListParams(
  params: ClientListParams = {},
): Required<ClientListParams> | null {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 25;
  const status = params.status ?? 'active';

  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    (status !== 'active' && status !== 'inactive' && status !== 'all')
  ) {
    return null;
  }

  // Both inclusive range endpoints must remain exactly representable as integers.
  const from = (page - 1) * pageSize;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(from + pageSize)) return null;

  return { page, pageSize, status };
}
