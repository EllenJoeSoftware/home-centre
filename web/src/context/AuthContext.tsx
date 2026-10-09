import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, setUnauthorizedHandler } from "../api/client";
import { getStoredUser, getToken, setStoredUser, setToken } from "../api/token";
import type { User } from "../api/types";

interface AuthState {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<User | null>(() => (getToken() ? getStoredUser<User>() : null));

  const logout = useCallback(() => {
    setToken(null);
    setStoredUser(null);
    setTokenState(null);
    setUser(null);
  }, []);

  // Global 401 -> back to login, remembering where we were.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout();
      if (!window.location.pathname.startsWith("/login")) {
        navigate("/login", { replace: true, state: { from: window.location.pathname + window.location.search } });
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [logout, navigate]);

  // Refresh the user profile on startup.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .me()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setStoredUser(u);
      })
      .catch(() => {
        /* 401 handled globally; network errors keep cached user */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    setToken(res.token);
    setStoredUser(res.user);
    setTokenState(res.token);
    setUser(res.user);
  }, []);

  const value = useMemo(() => ({ user, token, login, logout }), [user, token, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
