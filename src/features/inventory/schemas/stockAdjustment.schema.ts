import { z } from 'zod';

// PostgreSQL UUID shape, without an extra version/variant restriction or normalization.
export const inventoryUuidSchema = z
  .string({ error: 'Ingresa un identificador válido.' })
  .length(36, { error: 'Ingresa un identificador válido.' })
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    error: 'Ingresa un identificador válido.',
  });

export const adjustStockSchema = z
  .object({
    operationId: inventoryUuidSchema,
    productId: inventoryUuidSchema,
    quantityDelta: z
      .number({ error: 'Ingresa una cantidad entera distinta de cero.' })
      .int({ error: 'Ingresa una cantidad entera.' })
      .min(-2_147_483_648, { error: 'La cantidad queda fuera del rango permitido.' })
      .max(2_147_483_647, { error: 'La cantidad queda fuera del rango permitido.' })
      .refine((value) => value !== 0, { error: 'La cantidad debe ser distinta de cero.' }),
    reason: z.enum(['LOSS', 'ADJUSTMENT'], { error: 'Selecciona un motivo válido.' }),
    notes: z.string().nullable().optional(),
  })
  .refine((input) => input.reason !== 'LOSS' || input.quantityDelta < 0, {
    path: ['quantityDelta'],
    error: 'Una pérdida debe tener una cantidad negativa.',
  });

export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
