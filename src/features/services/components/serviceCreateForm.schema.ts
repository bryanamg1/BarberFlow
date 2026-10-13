import { z } from 'zod';

import {
  createServiceSchema,
  updateServiceSchema,
  type CreateServiceInput,
  type UpdateServiceInput,
} from '../schemas/service.schema';

// Validate text syntax before Number: never parse a prefix, round, or turn blank into zero.
const serviceFormValueSchema = z
  .object({
    name: createServiceSchema.shape.name,
    description: z.string().optional(),
    price: z
      .string()
      .regex(/^\d+(?:\.\d{1,2})?$/, {
        error: 'Ingresa un precio con hasta dos decimales usando punto.',
      })
      .transform((value) => Number(value)),
    duration_minutes: z
      .string()
      .regex(/^\d+$/, { error: 'Ingresa una duración en minutos enteros.' })
      .transform((value) => Number(value)),
  })
  // Widen the adapter output to the nullable domain contract without changing visual text values.
  .transform((values): CreateServiceInput => values);

export const serviceCreateFormSchema = serviceFormValueSchema.pipe(createServiceSchema);
export const serviceEditFormSchema = serviceFormValueSchema
  .transform((values): UpdateServiceInput => values)
  .pipe(updateServiceSchema);

export type ServiceCreateFormValues = z.input<typeof serviceCreateFormSchema>;
