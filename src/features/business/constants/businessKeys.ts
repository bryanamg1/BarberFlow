export const businessKeys = {
  current: (userId: string | null) => ['business', 'current', userId] as const,
};
