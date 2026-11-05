import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, clearToken, getToken, setToken } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  booting: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);
const CACHED_USER_KEY = 'vula_erp_user';

function loadCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => loadCachedUser());
  const [booting, setBooting] = useState(() => getToken() !== null);

  useEffect(() => {
    if (!getToken()) {
      setUser(null);
      setBooting(false);
      return;
    }
    api
      .get<{ user: User }>('/auth/me')
      .then((result) => {
        setUser(result.user);
        localStorage.setItem(CACHED_USER_KEY, JSON.stringify(result.user));
      })
      .catch((error) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          clearToken();
          localStorage.removeItem(CACHED_USER_KEY);
          setUser(null);
        }
      })
      .finally(() => setBooting(false));
  }, []);

  const login = async (email: string, password: string): Promise<User> => {
    const result = await api.post<{ token: string; user: User }>('/auth/login', {
      email,
      password,
    });
    setToken(result.token);
    setUser(result.user);
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(result.user));
    return result.user;
  };

  const logout = () => {
    clearToken();
    localStorage.removeItem(CACHED_USER_KEY);
    setUser(null);
  };

  const can = (permission: string) => Boolean(user?.permissions.includes(permission));

  return (
    <AuthContext.Provider value={{ user, booting, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
