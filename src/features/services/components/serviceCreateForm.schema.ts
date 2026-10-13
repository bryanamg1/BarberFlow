import { z } from 'zod';

import { createServiceSchema, type CreateServiceInput } from '../schemas/service.schema';

// Validate text syntax before Number: never parse a prefix, round, or turn blank into zero.
export const serviceCreateFormSchema = z
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
  .transform((values): CreateServiceInput => values)
  .pipe(createServiceSchema);

export type ServiceCreateFormValues = z.input<typeof serviceCreateFormSchema>;
