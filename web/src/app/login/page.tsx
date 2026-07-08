"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { DEFAULT_ROUTE } from "@/lib/nav";
import { Button, Input, Field } from "@/components/ui";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useT } from "@/lib/i18n";

type DemoUser = { username: string; label: string; hint: string };

// Надзорная вертикаль: инспектор → руководитель → замминистра.
const DEMO_OVERSIGHT: DemoUser[] = [
  { username: "inspector", label: "Инспектор", hint: "надзор на объектах" },
  { username: "supervisor", label: "Руководитель", hint: "управление надзора" },
  { username: "minister", label: "Замминистра", hint: "руководство ведомства" },
];

// Реагирование (ЦОУ, боевой расчёт) и внешние роли (владелец, администратор).
const DEMO_RESPONSE: DemoUser[] = [
  { username: "dispatcher", label: "Диспетчер", hint: "ЦОУ · 112" },
  { username: "responder", label: "Начальник караула", hint: "боевые расчёты ПЧ" },
  { username: "owner", label: "Владелец объекта", hint: "портал ОСИ" },
  { username: "admin", label: "Администратор", hint: "все модули" },
];

function DemoButton({
  d,
  busy,
  disabled,
  onSelect,
  t,
}: {
  d: DemoUser;
  busy: boolean;
  disabled?: boolean;
  onSelect: (username: string) => void;
  t: (ru: string) => string;
}) {
  return (
    <button
      onClick={() => onSelect(d.username)}
      disabled={busy || disabled}
      className="rounded-lg border border-border bg-surface px-2 py-2.5 text-center transition-colors hover:border-border-strong hover:bg-surface-2 disabled:opacity-50"
    >
      <div className="text-xs font-medium text-fg">{t(d.label)}</div>
      <div className="mt-0.5 text-2xs leading-tight text-faint">{t(d.hint)}</div>
    </button>
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const t = useT();
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
      setError(e instanceof Error ? e.message : t("Ошибка входа"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* Language switch (chrome; login body strings are Wave 1) */}
      <div className="absolute right-5 top-5 z-10">
        <LanguageSwitcher />
      </div>

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
            {t("Предиктивная платформа · ДЧС РК")}
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(username, password);
          }}
          className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-pop"
        >
          <Field label={t("Логин")}>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("Введите логин")}
              autoFocus
              autoComplete="username"
            />
          </Field>
          <Field label={t("Пароль")}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("Введите пароль")}
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
                <Loader2 className="h-4 w-4 animate-spin" /> {t("Вход…")}
              </>
            ) : (
              <>
                {t("Войти")} <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </form>

        <div className="mt-6 space-y-4">
          <p className="text-center text-2xs uppercase tracking-[0.16em] text-faint">
            {t("Быстрый вход для демонстрации")}
          </p>

          <div>
            <p className="mb-1.5 text-left text-2xs tracking-wide text-faint">
              {t("Надзорная вертикаль")}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {DEMO_OVERSIGHT.map((d) => (
                <DemoButton
                  key={d.username}
                  d={d}
                  busy={busy}
                  onSelect={(u) => submit(u, `${u}123`)}
                  t={t}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-left text-2xs tracking-wide text-faint">
              {t("Реагирование и внешние")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_RESPONSE.map((d) => (
                <DemoButton
                  key={d.username}
                  d={d}
                  busy={busy}
                  onSelect={(u) => submit(u, `${u}123`)}
                  t={t}
                />
              ))}
            </div>
          </div>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-2xs text-faint">
          <ShieldCheck className="h-3.5 w-3.5" />
          {t("Защищённый доступ · только для сотрудников ДЧС")}
        </p>
      </div>
    </main>
  );
}
