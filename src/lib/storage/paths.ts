import type { StorageUploadInput } from './types';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const operationalKey = new RegExp(`^${uuid}/${uuid}\\.(jpg|png)$`, 'i');
const receiptKey = new RegExp(`^${uuid}/${uuid}/${uuid}\\.(jpg|png|pdf)$`, 'i');

export function parseStoragePath(path: unknown) {
  if (typeof path !== 'string') return null;
  const slash = path.indexOf('/');
  const bucket = path.slice(0, slash);
  const objectKey = path.slice(slash + 1);
  if (
    ((bucket === 'avatars' || bucket === 'business-assets') && operationalKey.test(objectKey)) ||
    (bucket === 'receipts' && receiptKey.test(objectKey))
  )
    return { bucket, objectKey };
  return null;
}

export function uploadLocation(input: StorageUploadInput, avatarOwner?: string) {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }[
    input.contentType
  ];
  const filename = `${input.objectUuid}.${ext}`;
  switch (input.target.kind) {
    case 'avatar':
      return { bucket: 'avatars', objectKey: `${avatarOwner}/${filename}` };
    case 'businessLogo':
      return { bucket: 'business-assets', objectKey: `${input.target.businessId}/${filename}` };
    case 'expenseReceipt':
      return {
        bucket: 'receipts',
        objectKey: `${input.target.businessId}/${input.target.expenseId}/${filename}`,
      };
  }
}
