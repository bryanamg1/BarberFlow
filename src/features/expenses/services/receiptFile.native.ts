import type { DocumentPickerAsset } from 'expo-document-picker';
import { File } from 'expo-file-system';

export async function readReceiptFile(asset: DocumentPickerAsset, maxBytes: number) {
  if (!/^(file|content):\/\//.test(asset.uri)) throw new TypeError('Selected file unavailable.');
  const file = new File(asset.uri);
  if (!file.exists || file.size <= 0 || file.size > maxBytes)
    throw new TypeError('Selected file unavailable.');
  return file.arrayBuffer();
}
