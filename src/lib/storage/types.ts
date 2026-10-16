export type StorageTarget =
  | { kind: 'avatar' }
  | { kind: 'businessLogo'; businessId: string }
  | { kind: 'expenseReceipt'; businessId: string; expenseId: string };

export type StorageUploadInput = {
  target: StorageTarget;
  objectUuid: string;
  body: ArrayBuffer;
  contentType: 'image/jpeg' | 'image/png' | 'application/pdf';
};

export type StorageServiceError = {
  code: 'INVALID_INPUT' | 'ACCESS_DENIED' | 'NOT_FOUND' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR';
  message: string;
};

export type StorageResult<T> =
  { data: T; error: null } | { data: null; error: StorageServiceError };
