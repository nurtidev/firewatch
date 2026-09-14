"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { clearApiCache } from "./sw";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export type Role =
  | "inspector"
  | "supervisor"
  | "leadership"
  | "admin"
  | "owner"
  | "dispatcher"
  | "responder"
  | "akimat";
export type User = {
  username: string;
  name: string;
  role: Role;
  /** Пожарная часть боевой роли. Начальник караула ведёт технику только своей
   *  части (сервер отдаёт 403 на чужую), а видит — по всему городу: ему нужно
   *  знать, откуда идёт подкрепление. Без этого поля интерфейс рисовал бы
   *  действия, которые сервер запретит. */
  station?: { id: number; name: string } | null;
};

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
    // Планшет в части общий, а офлайн-кэш ключуется по адресу запроса, а не по
    // токену: без очистки заступивший караул увидел бы боевой пакет прошлой
    // смены как свой. Чистим на обоих концах — вход тоже, потому что выход
    // могли не сделать (сел аккумулятор, забрали планшет). До записи нового
    // токена: первые ответы уже новой учётной записи под очистку не попадут.
    await clearApiCache();
    localStorage.setItem("fw_token", data.token);
    localStorage.setItem("fw_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user as User;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("fw_token");
    localStorage.removeItem("fw_user");
    // Очередь расстановки не трогаем: она привязана к учётной записи, другому
    // пользователю не видна и уйдёт, когда владелец войдёт снова.
    void clearApiCache();
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

export type ApiFetchOpts = RequestInit & {
  /** false — не уводить со страницы на 401 (см. вызов ниже). Токен из
   *  localStorage всё равно снимается: он подтверждённо недействителен, и
   *  оставленным он даёт тот же 401 любому другому запросу со страницы. */
  authRedirect?: boolean;
};

/** Fetch an API path with the bearer token attached; on 401 → login.
 *
 *  `authRedirect: false` — для запросов, которые уходят в фоне и не должны
 *  выдёргивать человека с экрана посреди работы (см. deploymentQueue.flush):
 *  расстановку на пожаре синхронизирует очередь сама, без участия РТП, и её
 *  401 не повод срывать его с плана — только показать баннер «нужен
 *  повторный вход» и оставить действие на нём. Остальные вызовы (интерактивные,
 *  по нажатию) уводят на /login как раньше — так безопаснее по умолчанию. */
export async function apiFetch(
  path: string,
  opts: ApiFetchOpts = {},
): Promise<Response> {
  const { authRedirect = true, ...init } = opts;
  const headers = new Headers(init.headers);
  const token = authToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401 && typeof window !== "undefined") {
    localStorage.removeItem("fw_token");
    localStorage.removeItem("fw_user");
    if (authRedirect) window.location.href = "/login";
  }
  return res;
}

/** URL for <img>/<iframe> sources. These can't set an Authorization header, so
 *  the bearer token is passed as a `?token=` query param (see current_user). */
export function apiSrc(path: string): string {
  const token = authToken();
  if (!token) return `${API_URL}${path}`;
  const sep = path.includes("?") ? "&" : "?";
  return `${API_URL}${path}${sep}token=${encodeURIComponent(token)}`;
}
