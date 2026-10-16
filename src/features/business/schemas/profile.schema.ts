import { z } from 'zod';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const avatarPath = new RegExp(`^avatars/(${uuid})/${uuid}\\.(jpg|png)$`, 'i');
export function isOwnAvatarPath(path: string, userId: string) {
  return avatarPath.exec(path)?.[1].toLowerCase() === userId.toLowerCase();
}

// profiles requires text, but has no nonempty, trim or phone-format constraint.
export const profileUpdateSchema = z
  .object({
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    phone: z.string().nullable().optional(),
    avatar_path: z.string().regex(avatarPath).optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined));
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type ProfileRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  avatar_path: string | null;
  created_at: string;
  updated_at: string;
};
