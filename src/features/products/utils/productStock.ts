import type { ProductError } from '../types/productHooks.types';
import type {
  ProductStockLevel,
  ProductStockResult,
  ProductStockValue,
} from '../types/productStock.types';
import { productError } from './productErrors';

const stockInteger = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+$/.test(value);

// A missing/incoherent response is not a zero balance. Negative ledger values
// have no approved NORMAL presentation either; keep them unavailable.
export function selectProductStock(
  result: ProductStockResult,
  productId: string,
): ProductStockValue {
  if (result.status === 'pending') return { status: 'pending' };
  if (result.status === 'error') return { status: 'error', error: result.error };
  if (result.status !== 'success') return { status: 'unavailable' };
  const rows = result.data.filter((row) => row.product_id === productId);
  if (rows.length !== 1 || !stockInteger(rows[0].current_stock)) return { status: 'unavailable' };
  return { status: 'success', value: rows[0].current_stock };
}

export function classifyProductStock(
  stock: string,
  minimumStock: number,
): ProductStockLevel | null {
  if (!stockInteger(stock) || !Number.isSafeInteger(minimumStock) || minimumStock < 0) return null;
  const quantity = BigInt(stock);
  if (quantity === 0n) return 'OUT';
  return quantity <= BigInt(minimumStock) ? 'LOW' : 'NORMAL';
}

export function productStockError(reason: unknown): ProductError {
  const code =
    typeof reason === 'object' && reason !== null && 'code' in reason ? reason.code : null;
  if (code === 'INVENTORY_ACCESS_DENIED') return productError('PRODUCT_ACCESS_DENIED');
  if (code === 'NETWORK_ERROR') return productError('NETWORK_ERROR');
  if (code === 'INVALID_INPUT') return productError('INVALID_INPUT');
  return productError('UNKNOWN_ERROR');
}
