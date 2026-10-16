import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { uuid } from 'expo-modules-core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/features/auth/context/AuthContext';
import { storageService, type StorageServiceError } from '@/lib/storage';
import { useBusiness } from '../context/BusinessContext';
import {
  isOwnAvatarPath,
  type ProfileRow,
  type ProfileUpdateInput,
} from '../schemas/profile.schema';
import { avatarPicker } from '../services/avatarPicker';
import { profileError, profileService } from '../services/profileService';

export function useProfileSettings() {
  const auth = useAuth();
  const business = useBusiness();
  const userId =
    auth.status === 'authenticated' && business.status === 'success' ? auth.user.id : null;
  const scope =
    userId && business.status === 'success'
      ? `${userId}/${business.data.business.id}/${business.data.membershipId}`
      : null;
  const generation = useMemo(() => ({ scope }), [scope]);
  const current = useRef(generation);
  const flight = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    current.current = generation;
    flight.current = null;
    return () => {
      flight.current = null;
    };
  }, [generation]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const client = useQueryClient();
  const queryKey = ['profile', userId, scope] as const;
  const query = useQuery<ProfileRow, StorageServiceError>({
    queryKey,
    enabled: userId !== null,
    retry: false,
    queryFn:
      userId === null
        ? skipToken
        : async () => {
            const result = await profileService.get(userId);
            if (result.error) throw result.error;
            return result.data;
          },
  });
  const path = query.isSuccess ? query.data.avatar_path : null;
  const canSign = !!(userId && path && isOwnAvatarPath(path, userId));
  const image = useQuery<string, StorageServiceError>({
    queryKey: ['profile-avatar', userId, path],
    enabled: canSign,
    retry: false,
    staleTime: 240_000,
    gcTime: 0,
    refetchInterval: canSign ? 240_000 : false,
    queryFn:
      !canSign || !path
        ? skipToken
        : async () => {
            const result = await storageService.createSignedUrl(path);
            if (result.error) throw result.error;
            return result.data.signedUrl;
          },
  });
  const [feedback, setFeedback] = useState<{
    scope: typeof generation;
    busy: boolean;
    message?: string;
    error?: StorageServiceError;
  }>({ scope: generation, busy: false });
  const valid = (captured: typeof generation, operation: symbol) =>
    mounted.current && current.current === captured && flight.current === operation;
  async function run(
    action: (live: () => boolean, capturedUser: string) => Promise<string | null>,
  ) {
    if (!scope || !userId || flight.current) return;
    const operation = Symbol();
    flight.current = operation;
    const captured = generation;
    setFeedback({ scope: captured, busy: true });
    const live = () => valid(captured, operation);
    try {
      const message = await action(live, userId);
      if (live()) setFeedback({ scope: captured, busy: false, message: message ?? undefined });
    } catch (error) {
      if (live())
        setFeedback({
          scope: captured,
          busy: false,
          error:
            error && typeof error === 'object' && 'code' in error && 'message' in error
              ? (error as StorageServiceError)
              : profileError('UNKNOWN_ERROR'),
        });
    } finally {
      if (flight.current === operation) flight.current = null;
    }
  }
  return {
    query,
    available: scope !== null,
    email: auth.status === 'authenticated' ? (auth.user.email ?? '') : '',
    imageUri: canSign && image.isSuccess ? image.data : undefined,
    imageError: canSign && image.isError ? image.error : null,
    busy: feedback.scope === generation && feedback.busy,
    message: feedback.scope === generation ? feedback.message : undefined,
    error: feedback.scope === generation ? feedback.error : undefined,
    save: async (input: ProfileUpdateInput): Promise<ProfileRow | null> => {
      let saved: ProfileRow | null = null;
      await run(async (live, capturedUser) => {
        if (!live()) return null;
        const result = await profileService.update(capturedUser, input);
        if (result.error) throw result.error;
        if (!live()) return null;
        await client.invalidateQueries({ queryKey, exact: true });
        if (!live()) return null;
        saved = result.data;
        return 'Perfil guardado.';
      });
      return saved;
    },
    changeAvatar: () =>
      run(async (live, capturedUser) => {
        const selection = await avatarPicker.pick();
        if (!live() || selection.status === 'cancelled') return null;
        if (selection.status === 'error') throw selection.error;
        const uploaded = await storageService.upload({
          target: { kind: 'avatar' },
          objectUuid: uuid.v4(),
          body: selection.body,
          contentType: selection.contentType,
        });
        if (!live()) return null;
        if (uploaded.error) throw uploaded.error;
        if (!isOwnAvatarPath(uploaded.data.path, capturedUser)) throw profileError('ACCESS_DENIED');
        const persisted = await profileService.update(capturedUser, {
          avatar_path: uploaded.data.path,
        });
        if (persisted.error) throw persisted.error; // An ambiguous write must not delete the potentially current file.
        if (!live()) return null;
        await client.invalidateQueries({ queryKey, exact: true });
        if (!live()) return null;
        // Only confirmed replacement makes the former operational image eligible.
        if (path && path !== uploaded.data.path && isOwnAvatarPath(path, capturedUser)) {
          const cleanup = await storageService.remove(path);
          if (cleanup.error) return 'Avatar guardado. No se pudo limpiar el archivo anterior.';
        }
        return 'Avatar guardado.';
      }),
  };
}
