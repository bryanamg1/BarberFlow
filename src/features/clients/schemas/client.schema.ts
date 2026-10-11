import { z } from 'zod';

function isCivilDate(value: string): boolean {
  if (value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

const firstName = z
  .string({ error: 'Ingresa el nombre.' })
  .refine((value) => value.trim().length > 0, { error: 'Ingresa el nombre.' });
const nullableText = z.string({ error: 'Ingresa texto o null.' }).nullable().optional();
const birthDate = z
  .string({ error: 'Ingresa una fecha válida en formato YYYY-MM-DD.' })
  .refine(isCivilDate, { error: 'Ingresa una fecha válida en formato YYYY-MM-DD.' })
  .nullable()
  .optional();

export const createClientSchema = z.object({
  first_name: firstName,
  last_name: nullableText,
  phone: nullableText,
  email: nullableText,
  instagram: nullableText,
  birth_date: birthDate,
  notes: nullableText,
  preferences: nullableText,
});

export const updateClientSchema = createClientSchema
  .partial()
  .extend({ is_active: z.boolean({ error: 'Ingresa un estado activo válido.' }).optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: 'Ingresa al menos un campo para actualizar.',
  });

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
