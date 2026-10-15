import { z } from 'zod';

const id = z
  .string({ error: 'Ingresa un identificador válido.' })
  .refine((value) => value.trim().length > 0, { error: 'Ingresa un identificador válido.' });
const decimal = /^\d+\.\d{2}$/;
const maximumCents = 999_999_999_999n;
const cents = (value: string) => BigInt(value.replace('.', ''));
const money = z
  .string({ error: 'Ingresa el costo como un decimal con dos posiciones.' })
  .regex(decimal, { error: 'Ingresa un costo no negativo con dos decimales.' })
  .refine((value) => !decimal.test(value) || cents(value) <= maximumCents, {
    error: 'El costo supera el máximo permitido.',
  });
const item = z.object({
  productId: id,
  quantity: z
    .number({ error: 'Ingresa una cantidad entera positiva.' })
    .int({ error: 'Ingresa una cantidad entera positiva.' })
    .min(1, { error: 'La cantidad debe ser mayor que cero.' })
    .max(2_147_483_647, { error: 'La cantidad supera el máximo permitido.' }),
  unitCost: money,
});
const fields = z.object({
  operationId: id,
  supplierName: z
    .string({ error: 'Ingresa el proveedor.' })
    // Match PostgreSQL trim(text) for validation only; preserve the original text.
    .refine((value) => /[^ ]/.test(value), { error: 'Ingresa el proveedor.' }),
  expenseCategoryId: id,
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD', 'DIGITAL_WALLET'], {
    error: 'Selecciona un medio de pago válido.',
  }),
  purchasedAt: z.iso
    .datetime({ offset: true, error: 'Ingresa una fecha y hora válidas con zona horaria.' })
    .refine((value) => Number.isFinite(Date.parse(value)), {
      error: 'Ingresa una fecha y hora válidas con zona horaria.',
    }),
  notes: z.string({ error: 'Ingresa notas como texto o null.' }).nullable().optional(),
  items: z.array(item).min(1, { error: 'Agrega al menos un producto.' }),
});

export const completePurchaseSchema = fields.superRefine((value, context) => {
  // Never perform exact arithmetic on an invalid/coerced item. The base parser
  // owns those errors; unknown fields have already been stripped at both levels.
  if (!fields.safeParse(value).success) return;
  const costs = new Map<string, bigint>();
  let total = 0n;
  value.items.forEach((line, index) => {
    const cost = cents(line.unitCost);
    const previous = costs.get(line.productId);
    if (previous !== undefined && previous !== cost) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'unitCost'],
        message: 'Usa el mismo costo para un producto dentro de la compra.',
      });
    }
    costs.set(line.productId, cost);
    const lineTotal = cost * BigInt(line.quantity);
    if (lineTotal > maximumCents) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'unitCost'],
        message: 'El importe de la línea supera el máximo permitido.',
      });
    }
    total += lineTotal;
  });
  if (total > maximumCents) {
    context.addIssue({
      code: 'custom',
      path: ['items'],
      message: 'El total de la compra supera el máximo permitido.',
    });
  }
});

export type CompletePurchaseInput = z.infer<typeof completePurchaseSchema>;
export type CompletePurchaseItemInput = z.infer<typeof item>;
