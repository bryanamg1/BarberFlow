const scale = {
  8: 8,
  12: 12,
  16: 16,
  20: 20,
  24: 24,
  pill: 999,
} as const;

export const radius = {
  ...scale,
  card: scale[16],
  input: scale[12],
  button: scale[12],
} as const;
