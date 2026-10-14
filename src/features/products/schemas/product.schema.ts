import { z } from 'zod';

const name = z
  .string({ error: 'Ingresa el nombre del producto.' })
  // Match PostgreSQL trim(text) for validation while preserving the original value.
  .refine((value) => /[^ ]/.test(value), { error: 'Ingresa el nombre del producto.' });
const categoryId = z
  .string({ error: 'Ingresa un identificador de categoría válido.' })
  .refine((value) => value.trim().length > 0, {
    error: 'Ingresa un identificador de categoría válido.',
  });
const nullableText = z.string({ error: 'Ingresa texto o null.' }).nullable().optional();
const money = z
  .number({ error: 'Ingresa un importe válido.' })
  .min(0, { error: 'El importe no puede ser negativo.' })
  .max(9_999_999_999.99, { error: 'El importe supera el máximo permitido.' })
  // Canonical decimal text accepts cents such as 0.29 without binary modulo artifacts.
  .refine((value) => /^\d+(?:\.\d{1,2})?$/.test(value.toString()), {
    error: 'El importe debe tener como máximo dos decimales.',
  });
const minimumStock = z
  .number({ error: 'Ingresa un stock mínimo válido.' })
  .int({ error: 'El stock mínimo debe ser un número entero.' })
  .min(0, { error: 'El stock mínimo no puede ser negativo.' })
  .max(2_147_483_647, { error: 'El stock mínimo supera el máximo permitido.' });

const fields = {
  name,
  category_id: categoryId.nullable().optional(),
  description: nullableText,
  sku: nullableText,
  sale_price: money,
  default_purchase_cost: money,
  minimum_stock: minimumStock,
};

export const createProductSchema = z.object({
  ...fields,
  minimum_stock: minimumStock.default(0),
});

// A PATCH must not materialize the create default and reset an untouched threshold.
export const updateProductSchema = z
  .object(fields)
  .partial()
  .extend({ is_active: z.boolean({ error: 'Ingresa un estado activo válido.' }).optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: 'Ingresa al menos un campo para actualizar.',
  });

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
