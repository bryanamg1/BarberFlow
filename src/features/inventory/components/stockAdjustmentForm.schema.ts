import { z } from 'zod';
import { adjustStockSchema } from '../schemas/stockAdjustment.schema';

// Text-entry adapter only. The approved domain schema owns range, zero and LOSS rules.
export const stockAdjustmentFormSchema = z
  .object({
    ...adjustStockSchema.shape,
    quantityDelta: z
      .string()
      .regex(/^[+-]?\d+$/, 'Ingresa un entero con signo, por ejemplo -2 o +3.')
      .transform(Number),
  })
  .pipe(adjustStockSchema);
export type StockAdjustmentFormValues = z.input<typeof stockAdjustmentFormSchema>;
