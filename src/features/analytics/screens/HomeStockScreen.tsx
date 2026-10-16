import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/theme';
import { HomeLowStock } from '../components/HomeLowStock';

// BF263 composes only the stock section. Other Home tickets own their own sections.
export function HomeStockScreen() {
  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text role="heading" style={styles.heading}>
          Inicio
        </Text>
        <HomeLowStock />
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  // Approved desktop cap; this single-column section has no layout switch at 768.
  content: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    padding: theme.spacing[16],
    gap: theme.spacing[24],
  },
  heading: { ...theme.typography.headingLg, color: theme.colors.textPrimary },
});
