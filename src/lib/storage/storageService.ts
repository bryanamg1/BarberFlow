import { parseStoragePath } from './paths';
import { storageRepository } from './storageRepository';
import type { StorageResult, StorageServiceError, StorageUploadInput } from './types';
import { storageUploadSchema } from './validation';

const messages = {
  INVALID_INPUT: 'Revisa el archivo o la ruta seleccionada.',
  ACCESS_DENIED: 'No tienes acceso a este archivo.',
  NOT_FOUND: 'El archivo no está disponible.',
  NETWORK_ERROR: 'No se pudo conectar. Inténtalo nuevamente.',
  UNKNOWN_ERROR: 'No se pudo completar la operación del archivo. Inténtalo nuevamente.',
} as const;
const failure = (code: StorageServiceError['code']) =>
  ({
    data: null,
    error: { code, message: messages[code] },
  }) as const;

function normalize(error: unknown): StorageServiceError['code'] {
  if (typeof error !== 'object' || error === null) return 'UNKNOWN_ERROR';
  const value = error as {
    status?: number;
    statusCode?: string;
    code?: string;
    name?: string;
    originalError?: unknown;
  };
  if (
    value.status === 0 ||
    (value.name === 'StorageUnknownError' && value.originalError instanceof TypeError)
  )
    return 'NETWORK_ERROR';
  if (
    [401, 403].includes(value.status ?? -1) ||
    ['401', '403'].includes(value.statusCode ?? '') ||
    ['42501', 'AccessDenied', 'InvalidJWT', 'Unauthorized'].includes(value.code ?? '') ||
    value.name === 'AuthSessionMissingError'
  )
    return 'ACCESS_DENIED';
  if (value.status === 404 || value.statusCode === '404' || value.code === 'NoSuchKey')
    return 'NOT_FOUND';
  return 'UNKNOWN_ERROR';
}

export const storageService = {
  async upload(input: StorageUploadInput): Promise<StorageResult<{ path: string }>> {
    const parsed = storageUploadSchema.safeParse(input);
    if (!parsed.success) return failure('INVALID_INPUT');
    try {
      const result = await storageRepository.upload(parsed.data);
      if (result.error) return failure(normalize(result.error));
      if ('user' in result.data) return failure('ACCESS_DENIED');
      if (!parseStoragePath(result.data.fullPath)) return failure('UNKNOWN_ERROR');
      return { data: { path: result.data.fullPath }, error: null };
    } catch (error) {
      return failure(normalize(error));
    }
  },
  async remove(path: string): Promise<StorageResult<null>> {
    const parsed = parseStoragePath(path);
    if (!parsed) return failure('INVALID_INPUT');
    if (parsed.bucket === 'receipts') return failure('ACCESS_DENIED');
    try {
      const result = await storageRepository.remove(path);
      if (result.error) return failure(normalize(result.error));
      if (result.data?.length !== 1 || result.data[0].name !== parsed.objectKey)
        return failure('NOT_FOUND');
      return { data: null, error: null };
    } catch (error) {
      return failure(normalize(error));
    }
  },
  async createSignedUrl(path: string): Promise<StorageResult<{ signedUrl: string }>> {
    if (!parseStoragePath(path)) return failure('INVALID_INPUT');
    try {
      const result = await storageRepository.createSignedUrl(path);
      if (result.error) return failure(normalize(result.error));
      if (!result.data?.signedUrl) return failure('NOT_FOUND');
      return { data: { signedUrl: result.data.signedUrl }, error: null };
    } catch (error) {
      return failure(normalize(error));
    }
  },
};
