import { z } from 'zod';

const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('avatar') }),
  z.object({ kind: z.literal('businessLogo'), businessId: z.uuid() }),
  z.object({ kind: z.literal('expenseReceipt'), businessId: z.uuid(), expenseId: z.uuid() }),
]);

export const storageUploadSchema = z
  .object({
    target,
    objectUuid: z.uuid(),
    body: z.instanceof(ArrayBuffer),
    contentType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  })
  .superRefine((input, ctx) => {
    const receipt = input.target.kind === 'expenseReceipt';
    const sizeLimit = (receipt ? 10 : 5) * 1024 * 1024;
    if (!receipt && input.contentType === 'application/pdf') {
      ctx.addIssue({ code: 'custom', message: 'Formato no permitido.' });
    }
    if (input.body.byteLength > sizeLimit) {
      ctx.addIssue({ code: 'custom', message: 'Archivo demasiado grande.' });
    }
    // Check file signatures rather than trusting a caller's MIME/extension alone.
    // This is format identification, not a full decoder or a malware scanner.
    const signatures = {
      'image/png': [137, 80, 78, 71, 13, 10, 26, 10],
      'image/jpeg': [255, 216, 255],
      'application/pdf': [37, 80, 68, 70, 45],
    };
    try {
      const bytes = new Uint8Array(input.body);
      if (!signatures[input.contentType].every((byte, i) => bytes[i] === byte)) {
        ctx.addIssue({ code: 'custom', message: 'El contenido no coincide con el formato.' });
      }
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Archivo no disponible.' });
    }
  });
