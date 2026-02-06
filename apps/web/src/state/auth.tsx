import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../util/api';

type ApiUser = {
  id: string;
  wallet_address: string;
  created_at: string;
};

type AuthState =
  | { status: 'loading'; token: string | null; user: null }
  | { status: 'anonymous'; token: null; user: null }
  | { status: 'logged_in'; token: string; user: ApiUser };

type AuthContextValue = {
  state: AuthState;
  setToken: (token: string) => void;
  logout: () => void;
};

const TOKEN_KEY = 'bigbottle.access_token';

function readToken(): string | null {
  try {
    const v = localStorage.getItem(TOKEN_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (!token) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider(props: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(() => ({
    status: 'loading',
    token: readToken(),
    user: null
  }));

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const token = readToken();
      if (!token) {
        if (!cancelled) setState({ status: 'anonymous', token: null, user: null });
        return;
      }

      try {
        const res = await apiGet<{ user: ApiUser }>('/me', token);
        if (cancelled) return;
        setState({ status: 'logged_in', token, user: res.user });
      } catch {
        if (cancelled) return;
        writeToken(null);
        setState({ status: 'anonymous', token: null, user: null });
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      setToken(token) {
        writeToken(token);
        setState({ status: 'loading', token, user: null });
        // Re-validate token
        apiGet<{ user: ApiUser }>('/me', token)
          .then((res) => setState({ status: 'logged_in', token, user: res.user }))
          .catch(() => {
            writeToken(null);
            setState({ status: 'anonymous', token: null, user: null });
          });
      },
      logout() {
        writeToken(null);
        setState({ status: 'anonymous', token: null, user: null });
      }
    }),
    [state]
  );

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthContext missing');
  return ctx;
}

export async function exchangeWalletSignatureForToken(input: {
  address: string;
  signature: string;
  challenge_id: string;
}): Promise<{ access_token: string; user: ApiUser }> {
  return apiPost('/auth/verify', { challenge_id: input.challenge_id, signature: input.signature }, null);
}

