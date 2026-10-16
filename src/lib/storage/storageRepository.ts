import { supabase } from '@/lib/supabase/client';

import { parseStoragePath, uploadLocation } from './paths';
import type { StorageUploadInput } from './types';

function location(path: string) {
  const parsed = parseStoragePath(path);
  if (!parsed) throw new TypeError('Invalid Storage path.');
  return parsed;
}

export const storageRepository = {
  async upload(input: StorageUploadInput) {
    let avatarOwner: string | undefined;
    if (input.target.kind === 'avatar') {
      const identity = await supabase.auth.getUser();
      if (identity.error || !identity.data.user) return identity;
      avatarOwner = identity.data.user.id;
    }
    const { bucket, objectKey } = uploadLocation(input, avatarOwner);
    return supabase.storage.from(bucket).upload(objectKey, input.body, {
      contentType: input.contentType,
      cacheControl: '0',
      upsert: false,
    });
  },
  remove(path: string) {
    const { bucket, objectKey } = location(path);
    return supabase.storage.from(bucket).remove([objectKey]);
  },
  createSignedUrl(path: string) {
    const { bucket, objectKey } = location(path);
    return supabase.storage.from(bucket).createSignedUrl(objectKey, 300);
  },
};
