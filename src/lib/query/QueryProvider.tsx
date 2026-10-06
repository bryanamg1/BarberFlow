import { focusManager, onlineManager, QueryClientProvider } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useEffect, type PropsWithChildren } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

import { queryClient } from './client';

export function QueryProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    // Web retains TanStack's visibilitychange and online/offline listeners, including SSR.
    if (Platform.OS === 'web') return;

    let disposed = false;
    let networkEventReceived = false;

    const updateFocus = (state: AppStateStatus) => {
      if (!disposed) focusManager.setFocused(state === 'active');
    };
    const updateNetwork = (state: Network.NetworkState) => {
      const online =
        state.isConnected === false ? false : (state.isInternetReachable ?? state.isConnected);
      // An unknown reading must not turn the last known connection into offline.
      if (!disposed && typeof online === 'boolean') onlineManager.setOnline(online);
    };

    const appSubscription = AppState.addEventListener('change', updateFocus);
    if (AppState.currentState !== null) updateFocus(AppState.currentState);

    const networkSubscription = Network.addNetworkStateListener((state) => {
      networkEventReceived = true;
      updateNetwork(state);
    });
    void Network.getNetworkStateAsync()
      .then((state) => {
        // A delayed startup snapshot must not overwrite a newer connectivity event.
        if (!networkEventReceived) updateNetwork(state);
      })
      .catch(() => {
        // Retain the last known state (initially online) if the OS cannot report connectivity.
      });

    return () => {
      disposed = true;
      appSubscription.remove();
      networkSubscription.remove();
    };
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
