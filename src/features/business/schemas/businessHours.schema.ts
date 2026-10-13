import { z } from 'zod';

// Local civil time, not an instant. Preserve PostgreSQL's microseconds and 24:00 boundary.
export const civilTimeSchema = z
  .string()
  .regex(
    /^(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?|24:00(?::00(?:\.0{1,6})?)?)$/,
    'Usa HH:mm, con segundos opcionales; sin zona horaria.',
  );
function microseconds(value: string) {
  const [hour, minute, second = '0'] = value.split(':');
  const [whole, fraction = ''] = second.split('.');
  return (
    (Number(hour) * 3600 + Number(minute) * 60 + Number(whole)) * 1000000 +
    Number(fraction.padEnd(6, '0'))
  );
}
export const businessHourInputSchema = z
  .object({
    day_of_week: z.literal([0, 1, 2, 3, 4, 5, 6]),
    open_time: civilTimeSchema,
    close_time: civilTimeSchema,
    is_closed: z.boolean(),
  })
  .refine((row) => row.is_closed || microseconds(row.close_time) > microseconds(row.open_time), {
    message: 'El cierre debe ser posterior a la apertura. No se admiten horarios nocturnos.',
    path: ['close_time'],
  });
export const businessHoursInputSchema = z
  .array(businessHourInputSchema)
  .length(7)
  .refine(
    (rows) => new Set(rows.map((row) => row.day_of_week)).size === 7,
    'Configura cada día una sola vez.',
  );
export const businessHoursFormSchema = z.object({ days: businessHoursInputSchema });
export type BusinessHourInput = z.infer<typeof businessHourInputSchema>;
export type BusinessHoursInput = z.infer<typeof businessHoursInputSchema>;
