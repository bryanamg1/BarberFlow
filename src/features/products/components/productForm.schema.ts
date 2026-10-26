import { z } from 'zod';
import {
  createProductSchema,
  updateProductSchema,
  type CreateProductInput,
  type UpdateProductInput,
} from '../schemas/product.schema';
import type { ProductRow } from '../types/product.types';

// Text syntax first; Number only transports the existing numeric(12,2) contract.
// No prefix parsing, rounding, arithmetic, or blank-to-zero conversion.
const decimal = z
  .string()
  .regex(/^\d+(?:\.\d{1,2})?$/, {
    error: 'Ingresa un importe con hasta dos decimales usando punto.',
  })
  .transform(Number);
export const productFormSchema = z
  .object({
    name: createProductSchema.shape.name,
    description: z.string().nullable().optional(),
    sku: z.string().nullable().optional(),
    category_id: createProductSchema.shape.category_id,
    sale_price: decimal,
    default_purchase_cost: decimal,
    minimum_stock: z
      .string()
      .regex(/^\d+$/, {
        error: 'Ingresa un stock mínimo entero no negativo.',
      })
      .transform(Number),
  })
  .transform((values): z.input<typeof createProductSchema> => values)
  .pipe(createProductSchema);
export type ProductFormValues = z.input<typeof productFormSchema>;
export function productFormValues(product?: ProductRow): ProductFormValues {
  return product
    ? {
        name: product.name,
        description: product.description,
        sku: product.sku,
        category_id: product.category_id,
        sale_price: String(product.sale_price),
        default_purchase_cost: String(product.default_purchase_cost),
        minimum_stock: String(product.minimum_stock),
      }
    : { name: '', sale_price: '', default_purchase_cost: '', minimum_stock: '0' };
}
export function productDirtyInput(
  values: CreateProductInput,
  dirty: Partial<Record<keyof ProductFormValues, unknown>>,
): UpdateProductInput {
  const input: UpdateProductInput = {};
  if (dirty.name) input.name = values.name;
  if (dirty.description) input.description = values.description;
  if (dirty.sku) input.sku = values.sku;
  if (dirty.category_id) input.category_id = values.category_id;
  if (dirty.sale_price) input.sale_price = values.sale_price;
  if (dirty.default_purchase_cost) input.default_purchase_cost = values.default_purchase_cost;
  if (dirty.minimum_stock) input.minimum_stock = values.minimum_stock;
  return updateProductSchema.parse(input);
}
