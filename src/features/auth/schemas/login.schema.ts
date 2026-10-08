import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string({ error: 'Ingresa tu correo electrónico.' })
    .trim()
    .min(1, { error: 'Ingresa tu correo electrónico.' })
    .pipe(z.email({ error: 'Ingresa un correo electrónico válido.' })),
  password: z
    .string({ error: 'Ingresa tu contraseña.' })
    .min(1, { error: 'Ingresa tu contraseña.' }),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
