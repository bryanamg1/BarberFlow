import type { StorageResult, StorageServiceError } from '@/lib/storage';
import { profileRepository } from '../repositories/profileRepository';
import {
  isOwnAvatarPath,
  profileUpdateSchema,
  type ProfileRow,
  type ProfileUpdateInput,
} from '../schemas/profile.schema';

const messages = {
  INVALID_INPUT: 'Revisa los datos del perfil o el archivo seleccionado.',
  ACCESS_DENIED: 'No tienes acceso a este perfil o archivo.',
  NOT_FOUND: 'El perfil o archivo no está disponible.',
  NETWORK_ERROR: 'No se pudo conectar. Inténtalo nuevamente.',
  UNKNOWN_ERROR: 'No se pudo completar la operación. Inténtalo nuevamente.',
} as const;
export const profileError = (code: StorageServiceError['code']): StorageServiceError => ({
  code,
  message: messages[code],
});
const usableId = (id: string) => typeof id === 'string' && id.trim().length > 0;
async function operation(
  call: () => ReturnType<typeof profileRepository.getById>,
): Promise<StorageResult<ProfileRow>> {
  try {
    const result = await call();
    if (result.error)
      return {
        data: null,
        error: profileError(
          result.status === 0
            ? 'NETWORK_ERROR'
            : result.status === 401 || result.status === 403 || result.error.code === '42501'
              ? 'ACCESS_DENIED'
              : 'UNKNOWN_ERROR',
        ),
      };
    return result.data === null
      ? { data: null, error: profileError('NOT_FOUND') }
      : { data: result.data, error: null };
  } catch {
    return { data: null, error: profileError('UNKNOWN_ERROR') };
  }
}
export const profileService = {
  get(userId: string): Promise<StorageResult<ProfileRow>> {
    if (!usableId(userId))
      return Promise.resolve({ data: null, error: profileError('ACCESS_DENIED') });
    return operation(() => profileRepository.getById(userId));
  },
  update(userId: string, input: ProfileUpdateInput): Promise<StorageResult<ProfileRow>> {
    if (!usableId(userId))
      return Promise.resolve({ data: null, error: profileError('ACCESS_DENIED') });
    const parsed = profileUpdateSchema.safeParse(input);
    if (
      !parsed.success ||
      (parsed.data.avatar_path !== undefined && !isOwnAvatarPath(parsed.data.avatar_path, userId))
    )
      return Promise.resolve({ data: null, error: profileError('INVALID_INPUT') });
    return operation(() => profileRepository.update(userId, parsed.data));
  },
};
