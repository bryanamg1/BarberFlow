import type { BadgeTone } from '@/components/ui';
import type { ProductStockValue } from '../types/productStock.types';
import { classifyProductStock } from '../utils/productStock';

export function productStockPresentation(
  stock: ProductStockValue,
  minimumStock: number,
): { label: string; tone: BadgeTone } {
  if (stock.status === 'pending') return { label: 'Cargando stock…', tone: 'neutral' };
  if (stock.status === 'error') return { label: 'Error al cargar stock', tone: 'danger' };
  if (stock.status !== 'success') return { label: 'Stock no disponible', tone: 'neutral' };
  const level = classifyProductStock(stock.value, minimumStock);
  if (level === null) return { label: 'Stock no disponible', tone: 'neutral' };
  const suffix = { OUT: 'Sin stock', LOW: 'Stock bajo', NORMAL: 'Normal' }[level];
  const tones = { OUT: 'danger', LOW: 'warning', NORMAL: 'success' } as const;
  return {
    label: `Stock: ${stock.value} · ${suffix}`,
    tone: tones[level],
  };
}
