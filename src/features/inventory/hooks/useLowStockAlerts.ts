import { skipToken, useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useBusiness } from '@/features/business/context/BusinessContext';
import { businessSettingsKey } from '@/features/business/hooks/useBusinessSettings';
import {
  businessSettingsService,
  type SettingsError,
} from '@/features/business/services/businessSettingsService';
import { inventoryKeys } from '../constants/inventoryKeys';
import { inventoryUuidSchema } from '../schemas/stockAdjustment.schema';
import { inventoryService } from '../services/inventoryService';
import type {
  LowStockError,
  LowStockPage,
  UseLowStockAlertsResult,
} from '../types/lowStockAlerts.types';
import { lowStockError, normalizeLowStockParams } from '../utils/lowStockParams';

export type { UseLowStockAlertsResult } from '../types/lowStockAlerts.types';

export function useLowStockAlerts(page = 1, pageSize = 25): UseLowStockAlertsResult {
  const business = useBusiness();
  const auth = useAuth();
  // Both active roles may read. The existing OWNER-only administration hooks stay unchanged.
  const scope =
    business.status === 'success' &&
    auth.status === 'authenticated' &&
    inventoryUuidSchema.safeParse(business.data.business.id).success
      ? {
          businessId: business.data.business.id,
          membershipId: business.data.membershipId,
          userId: auth.user.id,
        }
      : null;
  const params = normalizeLowStockParams({ page, pageSize });
  const settings = useQuery<
    NonNullable<Awaited<ReturnType<typeof businessSettingsService.get>>['data']>,
    SettingsError | LowStockError
  >({
    queryKey: businessSettingsKey(scope),
    enabled: scope !== null && params !== null,
    retry: false,
    queryFn:
      scope === null
        ? skipToken
        : async () => {
            const result = await businessSettingsService.get(scope.businessId);
            if (result.error) throw result.error;
            if (
              !result.data ||
              typeof result.data.preferences?.low_stock_notifications !== 'boolean'
            )
              throw lowStockError('UNKNOWN_ERROR');
            return result.data;
          },
  });
  const enabled =
    scope !== null &&
    params !== null &&
    settings.isSuccess &&
    settings.data.preferences.low_stock_notifications === true;
  const alerts = useQuery<LowStockPage, LowStockError>({
    queryKey: inventoryKeys.lowStockAlerts(scope, page, pageSize),
    enabled,
    retry: false,
    queryFn:
      !enabled || scope === null || params === null
        ? skipToken
        : async () => {
            const result = await inventoryService.getLowStockProducts(scope.businessId, params);
            if (result.error) throw result.error;
            return result.data;
          },
  });
  const retry = async () => {
    if (scope === null || params === null) return;
    if (!settings.isSuccess || settings.isError) {
      await settings.refetch();
      return;
    }
    if (settings.data.preferences.low_stock_notifications) await alerts.refetch();
  };
  const controls = { isFetching: settings.isFetching || alerts.isFetching, retry };
  if (scope === null) return { ...controls, status: 'idle', data: null, error: null };
  if (params === null)
    return { ...controls, status: 'error', data: null, error: lowStockError('INVALID_INPUT') };
  if (settings.isError) return { ...controls, status: 'error', data: null, error: settings.error };
  if (!settings.isSuccess) return { ...controls, status: 'pending', data: null, error: null };
  if (settings.data.preferences.low_stock_notifications === false)
    return { ...controls, status: 'disabled', data: null, error: null };
  if (settings.data.preferences.low_stock_notifications !== true)
    return { ...controls, status: 'error', data: null, error: lowStockError('UNKNOWN_ERROR') };
  if (alerts.isError) return { ...controls, status: 'error', data: null, error: alerts.error };
  if (alerts.isSuccess) return { ...controls, status: 'success', data: alerts.data, error: null };
  return { ...controls, status: 'pending', data: null, error: null };
}
