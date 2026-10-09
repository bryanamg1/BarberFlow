import { z } from 'zod';
import { loginSchema } from './login.schema';

export const recoveryRequestSchema = loginSchema.pick({ email: true });
export const resetPasswordSchema = z
  .object({
    password: z.string().min(6, 'Usa al menos 6 caracteres.'),
    confirmation: z.string(),
  })
  .refine(({ password, confirmation }) => password === confirmation, {
    path: ['confirmation'],
    message: 'Las contraseñas deben coincidir.',
  });
export type RecoveryRequestValues = z.infer<typeof recoveryRequestSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
