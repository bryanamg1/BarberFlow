import type { BusinessMembership } from '../repositories/businessRepository';

export type CurrentBusiness = {
  membershipId: BusinessMembership['id'];
  role: BusinessMembership['role'];
  business: NonNullable<BusinessMembership['business']>;
};

export type CurrentBusinessErrorCode =
  | 'NO_ACTIVE_MEMBERSHIP'
  | 'AMBIGUOUS_CURRENT_BUSINESS'
  | 'BUSINESS_NOT_RESOLVABLE'
  | 'BUSINESS_INACTIVE'
  | 'NETWORK_ERROR'
  | 'BUSINESS_ACCESS_DENIED'
  | 'UNKNOWN_ERROR';

export type CurrentBusinessServiceError = {
  code: CurrentBusinessErrorCode;
  message: string;
};

export type CurrentBusinessResult =
  { data: CurrentBusiness; error: null } | { data: null; error: CurrentBusinessServiceError };
