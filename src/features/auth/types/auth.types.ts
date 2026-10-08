export type AuthErrorCode =
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_SESSION_EXPIRED'
  | 'AUTH_UNAUTHORIZED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export type AuthServiceError = {
  code: AuthErrorCode;
  message: string;
};

export type AuthResult<T> = { data: T; error: null } | { data: null; error: AuthServiceError };
