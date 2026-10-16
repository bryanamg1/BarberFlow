import {
  launchImageLibraryAsync,
  UIImagePickerPreferredAssetRepresentationMode,
} from 'expo-image-picker';
import type { StorageServiceError } from '@/lib/storage';
import { readAvatarFile } from './avatarFile';
import { profileError } from './profileService';

type Selection =
  | { status: 'cancelled' }
  | { status: 'selected'; body: ArrayBuffer; contentType: 'image/jpeg' | 'image/png' }
  | { status: 'error'; error: StorageServiceError };
export const avatarPicker = {
  async pick(): Promise<Selection> {
    try {
      // The system image picker needs no broad library permission. This call
      // happens directly from the press gesture (important on Web).
      const result = await launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        allowsMultipleSelection: false,
        preferredAssetRepresentationMode: UIImagePickerPreferredAssetRepresentationMode.Current,
      });
      if (result.canceled) return { status: 'cancelled' };
      const asset = result.assets[0];
      const contentType = asset?.mimeType || asset?.file?.type;
      const maxBytes = 5 * 1024 * 1024;
      if (
        !asset ||
        (contentType !== 'image/jpeg' && contentType !== 'image/png') ||
        (asset.fileSize !== undefined && asset.fileSize > maxBytes)
      )
        return {
          status: 'error',
          error: { code: 'INVALID_INPUT', message: 'Usa una imagen JPEG o PNG de hasta 5 MiB.' },
        };
      const body = await readAvatarFile(asset, maxBytes);
      if (body.byteLength === 0 || body.byteLength > maxBytes)
        return { status: 'error', error: profileError('INVALID_INPUT') };
      return { status: 'selected', body, contentType };
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      return {
        status: 'error',
        error: profileError(
          [
            'ERR_USER_REJECTED_PERMISSIONS',
            'E_MISSING_PERMISSION',
            'ERR_MISSING_PERMISSION',
            'E_PERMISSION_MISSING',
          ].includes(String(code))
            ? 'ACCESS_DENIED'
            : error instanceof RangeError
              ? 'INVALID_INPUT'
              : 'UNKNOWN_ERROR',
        ),
      };
    }
  },
};
