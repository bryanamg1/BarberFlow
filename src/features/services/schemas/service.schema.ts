import { z } from 'zod';

const name = z
  .string({ error: 'Ingresa el nombre del servicio.' })
  // PostgreSQL trim(text) removes ASCII spaces, not every Unicode whitespace character.
  .refine((value) => /[^ ]/.test(value), { error: 'Ingresa el nombre del servicio.' });

const price = z
  .number({ error: 'Ingresa un precio válido.' })
  .min(0, { error: 'El precio no puede ser negativo.' })
  .max(9_999_999_999.99, { error: 'El precio supera el máximo permitido.' })
  // Canonical decimal text avoids binary modulo artifacts for values such as 0.29.
  .refine((value) => /^\d+(?:\.\d{1,2})?$/.test(value.toString()), {
    error: 'El precio debe tener como máximo dos decimales.',
  });

const durationMinutes = z
  .number({ error: 'Ingresa una duración válida.' })
  .int({ error: 'La duración debe ser un número entero de minutos.' })
  .min(1, { error: 'La duración debe ser mayor que cero.' })
  .max(2_147_483_647, { error: 'La duración supera el máximo permitido.' });

export const createServiceSchema = z.object({
  name,
  description: z.string({ error: 'Ingresa texto o null.' }).nullable().optional(),
  price,
  duration_minutes: durationMinutes,
});

export const updateServiceSchema = createServiceSchema
  .partial()
  .extend({ is_active: z.boolean({ error: 'Ingresa un estado activo válido.' }).optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: 'Ingresa al menos un campo para actualizar.',
  });

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
