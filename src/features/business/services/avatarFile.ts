import type { ImagePickerAsset } from 'expo-image-picker';

export async function readAvatarFile(
  asset: ImagePickerAsset,
  maxBytes: number,
): Promise<ArrayBuffer> {
  // Web's picker supplies the browser File. Do not fetch arbitrary asset URIs.
  if (!asset.file) throw new TypeError('Selected file unavailable.');
  if (asset.file.size > maxBytes) throw new RangeError('Selected file too large.');
  return asset.file.arrayBuffer();
}
