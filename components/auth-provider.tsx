'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  clearAccessToken as clearStoredAccessToken,
  getAccessToken,
  setAccessToken as setStoredAccessToken,
  subscribeToAccessToken,
} from '@/lib/auth/client-session';

type AuthContextValue = {
  accessToken: string | null;
  isAuthenticated: boolean;
  setAccessToken: (token: string | null) => void;
  clearAccessToken: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const accessToken = useSyncExternalStore(
    subscribeToAccessToken,
    getAccessToken,
    () => null,
  );

  const setAccessToken = useCallback((token: string | null) => {
    setStoredAccessToken(token);
  }, []);

  const clearAccessToken = useCallback(() => {
    clearStoredAccessToken();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      accessToken,
      isAuthenticated: Boolean(accessToken),
      setAccessToken,
      clearAccessToken,
    }),
    [accessToken, clearAccessToken, setAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
