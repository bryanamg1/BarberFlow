import { z } from 'zod';

const name = z
  .string({ error: 'Ingresa el nombre de la categoría.' })
  .refine((value) => /[^ ]/.test(value), { error: 'Ingresa el nombre de la categoría.' });
export const createExpenseCategorySchema = z.object({ name });
export const updateExpenseCategorySchema = createExpenseCategorySchema
  .partial()
  .extend({ is_active: z.boolean().optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: 'Ingresa al menos un campo para actualizar.',
  });
export type CreateExpenseCategoryInput = z.infer<typeof createExpenseCategorySchema>;
export type UpdateExpenseCategoryInput = z.infer<typeof updateExpenseCategorySchema>;
