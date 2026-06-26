"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { DEFAULT_ROUTE } from "@/lib/nav";

const DEMO = [
  { username: "minister", label: "Замминистра", hint: "руководство ведомства" },
  { username: "supervisor", label: "Руководитель", hint: "управление надзора" },
  { username: "inspector", label: "Инспектор", hint: "надзор на объектах" },
];

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(u: string, p: string) {
    setBusy(true);
    setError(null);
    try {
      const user = await login(u, p);
      router.replace(DEFAULT_ROUTE[user.role]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка входа");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-3xl font-bold">
            FireWatch<span style={{ color: "var(--fw-accent)" }}>.</span>
          </div>
          <p className="mt-1 text-xs tracking-widest text-neutral-500">
            ИНТЕЛЛЕКТУАЛЬНАЯ ПЛАТФОРМА · ДЧС РК
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(username, password);
          }}
          className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-950 p-5"
        >
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Логин"
            autoFocus
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md px-4 py-2.5 text-sm font-medium text-black disabled:opacity-50"
            style={{ background: "var(--fw-accent)" }}
          >
            {busy ? "Вход…" : "Войти"}
          </button>
        </form>

        <div className="mt-5">
          <p className="mb-2 text-center text-[10px] tracking-widest text-neutral-600">
            БЫСТРЫЙ ВХОД ДЛЯ ДЕМОНСТРАЦИИ
          </p>
          <div className="grid grid-cols-3 gap-2">
            {DEMO.map((d) => (
              <button
                key={d.username}
                onClick={() => submit(d.username, `${d.username}123`)}
                disabled={busy}
                className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-2 text-center hover:border-neutral-600 disabled:opacity-50"
              >
                <div className="text-xs font-medium text-neutral-200">
                  {d.label}
                </div>
                <div className="mt-0.5 text-[9px] leading-tight text-neutral-500">
                  {d.hint}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
