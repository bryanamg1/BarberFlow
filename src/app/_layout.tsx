import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { FontDisplay, useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AuthProvider } from '@/features/auth/context/AuthContext';
import { AuthNavigator } from '@/features/auth/routing/AuthNavigator';
import { QueryProvider } from '@/lib/query';
import { fontFamilies } from '@/theme/typography';

// Direct weight imports keep unused Inter faces out of the application bundle.
const interFonts = {
  [fontFamilies.regular]: { uri: Inter_400Regular, display: FontDisplay.BLOCK },
  [fontFamilies.medium]: { uri: Inter_500Medium, display: FontDisplay.BLOCK },
  [fontFamilies.semibold]: { uri: Inter_600SemiBold, display: FontDisplay.BLOCK },
  [fontFamilies.bold]: { uri: Inter_700Bold, display: FontDisplay.BLOCK },
};

// Run before the first render so native startup waits for the bundled font assets.
void SplashScreen.preventAutoHideAsync().catch((error) => {
  console.warn('Unable to retain the splash screen while Inter loads.', error);
});

export const unstable_settings = {
  initialRouteName: '(app)',
};

export default function RootLayout() {
  const [loaded, error] = useFonts(interFonts);

  useEffect(() => {
    if (error) {
      console.warn('Unable to load Inter. Continuing with the system font.', error);
    }

    if (loaded || error) {
      SplashScreen.hide();
    }
  }, [loaded, error]);

  if (!loaded && !error) {
    return null;
  }

  return (
    <QueryProvider>
      <AuthProvider>
        <AuthNavigator />
      </AuthProvider>
    </QueryProvider>
  );
}
