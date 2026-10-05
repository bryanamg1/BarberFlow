import { Platform, type ViewStyle } from 'react-native';

// Restrained defaults: the approved design specifies elevation, but no numerical shadow scale.
// Native shadow props/elevation also support Android versions below boxShadow's API requirement.
export const shadows = {
  none:
    Platform.select<Readonly<ViewStyle>>({
      ios: { shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 } },
      android: { elevation: 0 },
      web: { boxShadow: 'none' },
      default: {},
    }) ?? {},
  raised:
    Platform.select<Readonly<ViewStyle>>({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
      web: { boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)' },
      default: {},
    }) ?? {},
  floating:
    Platform.select<Readonly<ViewStyle>>({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.24,
        shadowRadius: 6,
      },
      android: { elevation: 4 },
      web: { boxShadow: '0 4px 12px rgba(0, 0, 0, 0.24)' },
      default: {},
    }) ?? {},
} as const satisfies Record<string, ViewStyle>;
