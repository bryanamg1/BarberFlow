export const colors = {
  background: '#071116',
  surface: '#0C171D',
  surfaceRaised: '#101E25',
  surfaceStrong: '#15262E',
  primary: '#17E5E5',
  primaryPressed: '#0FC1C6',
  primaryMuted: '#12383D',
  accent: '#F1A23A',
  accentMuted: '#3E2D1B',
  textPrimary: '#F4F7F8',
  textSecondary: '#97A5AD',
  textMuted: '#65737B',
  border: '#1C3038',
  borderStrong: '#28515A',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  overlay: 'rgba(0, 0, 0, 0.65)',
} as const;

// Status color must always accompany a label or icon, never replace it.
export const semanticColors = {
  appointmentStatus: {
    PENDING: colors.warning,
    CONFIRMED: colors.primary,
    IN_PROGRESS: colors.accent,
    COMPLETED: colors.success,
    CANCELLED: colors.danger,
    NO_SHOW: colors.textMuted,
  },
  stockStatus: {
    NORMAL: colors.success,
    LOW: colors.warning,
    OUT: colors.danger,
  },
  finance: {
    revenue: colors.primary,
    expense: colors.danger,
    positiveResult: colors.success,
  },
  navigation: {
    active: colors.primary,
    inactive: colors.textMuted,
  },
  input: {
    focusedBorder: colors.primary,
    errorBorder: colors.danger,
  },
} as const;
