import { createContext, useContext, type PropsWithChildren } from 'react';

import { useCurrentBusiness, type UseCurrentBusinessResult } from '../hooks/useCurrentBusiness';

export type BusinessContextValue = UseCurrentBusinessResult;

const BusinessContext = createContext<BusinessContextValue | undefined>(undefined);

export function BusinessProvider({ children }: PropsWithChildren) {
  const value = useCurrentBusiness();
  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness(): BusinessContextValue {
  const value = useContext(BusinessContext);
  if (value === undefined) {
    throw new Error('useBusiness debe usarse dentro de BusinessProvider.');
  }
  return value;
}
