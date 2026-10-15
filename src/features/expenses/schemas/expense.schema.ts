import { z } from 'zod';

const decimal = /^\d+(?:\.\d{1,2})?$/;
const maximumCents = 999_999_999_999n;
const money = z
  .string({ error: 'Ingresa el importe como texto decimal.' })
  .regex(decimal, { error: 'Ingresa un importe no negativo con hasta dos decimales.' })
  .refine(
    (value) => {
      if (!decimal.test(value)) return true;
      const [whole, fraction = ''] = value.split('.');
      return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')) <= maximumCents;
    },
    { error: 'El importe supera el máximo permitido.' },
  );

// Application contract HD-006. The legacy expenses payment CHECK is not yet
// compatible; these schemas alone do not enable real INSERT/UPDATE operations.
export const createManualExpenseSchema = z.object({
  category_id: z
    .string({ error: 'Selecciona una categoría válida.' })
    .refine((value) => value.trim().length > 0, { error: 'Selecciona una categoría válida.' }),
  description: z.string({ error: 'Ingresa la descripción como texto.' }),
  amount: money,
  payment_method: z.enum(['CASH', 'BANK_TRANSFER', 'DEBIT_CARD', 'CREDIT_CARD', 'DIGITAL_WALLET'], {
    error: 'Selecciona un medio de pago válido.',
  }),
  expense_date: z.iso
    .date({ error: 'Ingresa una fecha válida en formato YYYY-MM-DD.' })
    .refine((value) => !value.startsWith('0000-'), {
      error: 'Ingresa una fecha entre los años 0001 y 9999.',
    }),
  receipt_path: z.string({ error: 'Ingresa la ruta como texto o null.' }).nullable().optional(),
  notes: z.string({ error: 'Ingresa notas como texto o null.' }).nullable().optional(),
});

export const updateManualExpenseSchema = createManualExpenseSchema
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: 'Incluye al menos un campo editable.',
  });

export type CreateManualExpenseInput = z.infer<typeof createManualExpenseSchema>;
export type UpdateManualExpenseInput = z.infer<typeof updateManualExpenseSchema>;
