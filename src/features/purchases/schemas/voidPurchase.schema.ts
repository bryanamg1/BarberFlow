import { z } from 'zod';

export const voidPurchaseIdSchema = z
  .string()
  .regex(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i);

export const voidPurchaseSchema = z.object({
  operationId: voidPurchaseIdSchema,
  purchaseId: voidPurchaseIdSchema,
  reason: z.string().refine((value) => /[^ ]/.test(value)),
});

export type VoidPurchaseInput = z.infer<typeof voidPurchaseSchema>;
