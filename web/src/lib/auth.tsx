"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export type Role = "inspector" | "supervisor" | "leadership" | "admin";
export type User = { username: string; name: string; role: Role };

type AuthCtx = {
  user: User | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  ready: false,
  login: async () => {
    throw new Error("no provider");
  },
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("fw_user");
      if (raw) setUser(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.detail || "Ошибка входа");
    }
    const data = await res.json();
    localStorage.setItem("fw_token", data.token);
    localStorage.setItem("fw_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user as User;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("fw_token");
    localStorage.removeItem("fw_user");
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, ready, login, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);

export function authToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("fw_token");
}
