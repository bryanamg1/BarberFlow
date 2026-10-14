import { useState } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { theme } from '@/theme';

export type AvatarProps = {
  label: string;
  imageUri?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

function initialsFrom(label: string): string {
  const words = label.trim().split(/\s+/);
  if (!words[0]) return '?';
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : '';
  return (first + last).toUpperCase();
}

function AvatarContent({ imageUri, initials }: { imageUri?: string; initials: string }) {
  const [failed, setFailed] = useState(false);
  if (!imageUri || failed) {
    return (
      <Text style={styles.initials} numberOfLines={1}>
        {initials}
      </Text>
    );
  }
  return (
    <Image
      source={{ uri: imageUri }}
      resizeMode="cover"
      accessible={false}
      style={styles.image}
      onError={() => setFailed(true)}
    />
  );
}

export function Avatar({ label, imageUri, accessibilityLabel, style }: AvatarProps) {
  const spokenLabel = accessibilityLabel?.trim()
    ? accessibilityLabel
    : label.trim()
      ? label
      : 'Avatar';
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={spokenLabel}
      style={[styles.container, style, styles.geometry]}
    >
      <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {/* A new URI owns fresh failure state; late errors cannot affect the new image. */}
        <AvatarContent key={imageUri} imageUri={imageUri} initials={initialsFrom(label)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceStrong,
  },
  geometry: {
    width: theme.sizing.touchTarget,
    height: theme.sizing.touchTarget,
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
    flexShrink: 0,
  },
  image: { width: theme.sizing.touchTarget, height: theme.sizing.touchTarget },
  initials: { ...theme.typography.bodyMedium, color: theme.colors.textPrimary },
});
