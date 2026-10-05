// Web static rendering has no localStorage; Supabase uses its in-memory fallback there.
export const authStorage = typeof localStorage !== 'undefined' ? localStorage : undefined;
