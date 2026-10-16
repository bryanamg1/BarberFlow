import { File } from 'expo-file-system';
import type { ImagePickerAsset } from 'expo-image-picker';

export async function readAvatarFile(
  asset: ImagePickerAsset,
  maxBytes: number,
): Promise<ArrayBuffer> {
  // FileSystem is already provided by the installed Expo SDK. Read unchanged
  // bytes; picker base64 can re-encode images as JPEG on iOS.
  if (!/^(file|content):\/\//.test(asset.uri)) throw new TypeError('Selected file unavailable.');
  const file = new File(asset.uri);
  if (file.size > maxBytes) throw new RangeError('Selected file too large.');
  return file.arrayBuffer();
}
