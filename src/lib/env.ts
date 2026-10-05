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

export type Env = z.infer<typeof envSchema>;
export const env: Env = result.data;
