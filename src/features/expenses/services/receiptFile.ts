import type { DocumentPickerAsset } from 'expo-document-picker';

export async function readReceiptFile(asset: DocumentPickerAsset, maxBytes: number) {
  // Web bytes come from the selected File, never from fetching an arbitrary URI.
  if (!asset.file || asset.file.size <= 0 || asset.file.size > maxBytes)
    throw new TypeError('Selected file unavailable.');
  return asset.file.arrayBuffer();
}
