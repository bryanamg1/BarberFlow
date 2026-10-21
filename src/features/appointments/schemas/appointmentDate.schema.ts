import { z } from 'zod';

// Civil calendar value, not an instant. Reused by availability and the date field.
export const appointmentCivilDateSchema = z.iso
  .date({ error: 'Ingresa una fecha válida en formato YYYY-MM-DD.' })
  .refine((value) => !value.startsWith('0000-'), {
    error: 'Ingresa una fecha entre los años 0001 y 9999.',
  });
