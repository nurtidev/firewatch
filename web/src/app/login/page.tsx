"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { DEFAULT_ROUTE } from "@/lib/nav";
import { Button, Input, Field } from "@/components/ui";

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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* Ambient brand glow — single, restrained */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[620px] -translate-x-1/2 rounded-full opacity-[0.12] blur-[120px]"
        style={{ background: "var(--color-accent)" }}
        aria-hidden
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-7 text-center">
          <div className="text-3xl font-bold tracking-tight">
            FireWatch<span className="text-accent">.</span>
          </div>
          <p className="mt-2 text-2xs font-medium uppercase tracking-[0.18em] text-faint">
            Предиктивная платформа · ДЧС РК
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(username, password);
          }}
          className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-pop"
        >
          <Field label="Логин">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Введите логин"
              autoFocus
              autoComplete="username"
            />
          </Field>
          <Field label="Пароль">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введите пароль"
              autoComplete="current-password"
            />
          </Field>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-critical/40 bg-critical-bg px-3 py-2 text-sm text-critical"
            >
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Вход…
              </>
            ) : (
              <>
                Войти <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </form>

        <div className="mt-6">
          <p className="mb-2.5 text-center text-2xs uppercase tracking-[0.16em] text-faint">
            Быстрый вход для демонстрации
          </p>
          <div className="grid grid-cols-3 gap-2">
            {DEMO.map((d) => (
              <button
                key={d.username}
                onClick={() => submit(d.username, `${d.username}123`)}
                disabled={busy}
                className="rounded-lg border border-border bg-surface px-2 py-2.5 text-center transition-colors hover:border-border-strong hover:bg-surface-2 disabled:opacity-50"
              >
                <div className="text-xs font-medium text-fg">{d.label}</div>
                <div className="mt-0.5 text-2xs leading-tight text-faint">
                  {d.hint}
                </div>
              </button>
            ))}
          </div>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-2xs text-faint">
          <ShieldCheck className="h-3.5 w-3.5" />
          Защищённый доступ · только для сотрудников ДЧС
        </p>
      </div>
    </main>
  );
}
