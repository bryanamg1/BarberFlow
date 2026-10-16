import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/theme';

export function NavigationPlaceholder({ label }: { label: string }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing[16] },
  text: { ...theme.typography.body, color: theme.colors.textPrimary },
});
