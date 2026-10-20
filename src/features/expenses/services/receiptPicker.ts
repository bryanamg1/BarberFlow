import { getDocumentAsync } from 'expo-document-picker';
import { readReceiptFile } from './receiptFile';

const receiptTypes = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const receiptMaxBytes = 10 * 1024 * 1024;
export type SelectedReceipt = {
  name: string;
  contentType: (typeof receiptTypes)[number];
  size: number;
  body: ArrayBuffer;
};
type Selection =
  | { status: 'cancelled' }
  | { status: 'selected'; file: SelectedReceipt }
  | { status: 'error'; message: string };

export const receiptPicker = {
  async pick(): Promise<Selection> {
    try {
      const result = await getDocumentAsync({
        type: [...receiptTypes],
        multiple: false,
        copyToCacheDirectory: true,
        base64: false,
      });
      if (result.canceled) return { status: 'cancelled' };
      const asset = result.assets[0];
      const contentType = asset?.mimeType;
      if (
        !asset ||
        !asset.uri?.trim() ||
        !receiptTypes.includes(contentType as SelectedReceipt['contentType']) ||
        typeof asset.size !== 'number' ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0 ||
        asset.size > receiptMaxBytes
      )
        return {
          status: 'error',
          message: 'Usa un PDF, JPEG o PNG de hasta 10 MiB con tamaño conocido.',
        };
      const body = await readReceiptFile(asset, receiptMaxBytes);
      // BF234A revalidates MIME/size and bytes before its SDK upload.
      if (
        body.byteLength === 0 ||
        body.byteLength > receiptMaxBytes ||
        body.byteLength !== asset.size
      )
        return {
          status: 'error',
          message: 'El archivo no coincide con su tipo o tamaño declarado.',
        };
      return {
        status: 'selected',
        file: {
          // A display name only: strip path fragments/control and bidi characters.
          name: (asset.name.split(/[\\/]/).pop() || 'Comprobante')
            .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
            .slice(0, 120),
          contentType: contentType as SelectedReceipt['contentType'],
          size: body.byteLength,
          body,
        },
      };
    } catch {
      return {
        status: 'error',
        message: 'No se pudo leer el comprobante. Vuelve a seleccionarlo.',
      };
    }
  },
};
