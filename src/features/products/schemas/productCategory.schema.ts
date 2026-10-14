import { z } from 'zod';

const name = z
  .string({ error: 'Ingresa el nombre de la categoría.' })
  .refine((value) => /[^ ]/.test(value), { error: 'Ingresa el nombre de la categoría.' });
export const createProductCategorySchema = z.object({ name });
export const updateProductCategorySchema = createProductCategorySchema
  .partial()
  .extend({ is_active: z.boolean().optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: 'Ingresa al menos un campo para actualizar.',
  });
export type CreateProductCategoryInput = z.infer<typeof createProductCategorySchema>;
export type UpdateProductCategoryInput = z.infer<typeof updateProductCategorySchema>;
