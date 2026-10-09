import { z } from 'zod';

const envSchema = z
  .object({
    EXPO_PUBLIC_SUPABASE_URL: z
      .string()
      .trim()
      .pipe(z.url({ protocol: /^https?$/ })),
    EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().trim().min(1),
  })
  .readonly();

// Expo requires static property access to inline public variables in application bundles.
const result = envSchema.safeParse({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

if (!result.success) {
  const invalidVariables = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];

  // Report variable names only; never include configuration values or raw Zod errors.
  throw new Error(
    `Missing or invalid public environment variables: ${invalidVariables.join(', ')}. ` +
      'Set these values in .env.local and reload Expo.',
  );
}

export const env = Object.freeze({
  supabaseUrl: result.data.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: result.data.EXPO_PUBLIC_SUPABASE_ANON_KEY,
});

export type Env = typeof env;

// Optional for the app itself, required explicitly when requesting recovery on Web.
const webRecoveryRedirect = process.env.EXPO_PUBLIC_AUTH_RECOVERY_REDIRECT_URL;

export function getWebRecoveryRedirectUrl(): string {
  const parsed = z
    .url({ protocol: /^https?$/ })
    .refine((value) => {
      const url = new URL(value);
      return (
        url.pathname === '/auth/recovery' &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password
      );
    })
    .safeParse(webRecoveryRedirect);
  if (!parsed.success) {
    throw new Error('Missing or invalid EXPO_PUBLIC_AUTH_RECOVERY_REDIRECT_URL.');
  }
  return parsed.data;
}
