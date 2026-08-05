"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck, Loader2 } from "lucide-react";
import { useAuth, type Role } from "@/lib/auth";
import { DEFAULT_ROUTE } from "@/lib/nav";
import { Button, Input, Field } from "@/components/ui";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { FireWatchMark } from "@/components/FireWatchMark";
import { useT } from "@/lib/i18n";

type DemoUser = { username: string; label: string; hint: string };

/* Один демо-пользователь на каждую роль (сиды api/scripts/seed_users.py,
   пароль всегда `${username}123`). Record<Role, …> — компилятор не даст
   забыть кнопку при добавлении 8-й роли. Лейблы — компактные демо-персоны
   («Замминистра», «Руководитель»), намеренно НЕ ROLE_LABEL из nav.ts. */
const DEMO_BY_ROLE: Record<Role, DemoUser> = {
  inspector: { username: "inspector", label: "Инспектор", hint: "надзор на объектах" },
  supervisor: { username: "supervisor", label: "Руководитель", hint: "управление надзора" },
  leadership: { username: "minister", label: "Замминистра", hint: "руководство ведомства" },
  dispatcher: { username: "dispatcher", label: "Диспетчер", hint: "ЦОУ · 112" },
  responder: { username: "responder", label: "Начальник караула", hint: "боевые расчёты ПЧ" },
  owner: { username: "owner", label: "Владелец объекта", hint: "портал ОСИ" },
  admin: { username: "admin", label: "Администратор", hint: "все модули" },
};

const DEMO_GROUPS: { title: string; colsClass: string; roles: Role[] }[] = [
  {
    title: "Надзорная вертикаль",
    colsClass: "grid-cols-3",
    roles: ["inspector", "supervisor", "leadership"],
  },
  {
    title: "Реагирование и внешние",
    colsClass: "grid-cols-2",
    roles: ["dispatcher", "responder", "owner", "admin"],
  },
];

function DemoButton({
  d,
  busy,
  onSelect,
}: {
  d: DemoUser;
  busy: boolean;
  onSelect: (username: string) => void;
}) {
  const t = useT();
  return (
    <button
      onClick={() => onSelect(d.username)}
      disabled={busy}
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

  const demoLogin = (u: string) => submit(u, `${u}123`);

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
          <div className="flex items-center justify-center gap-2.5 text-3xl font-bold tracking-tight">
            <FireWatchMark size={32} />
            FireWatch<span className="text-accent">.</span>
          </div>
          <p className="mt-2 text-2xs font-medium uppercase tracking-[0.18em] text-faint">
            {t("Предиктивная платформа · МЧС РК")}
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

          {DEMO_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="mb-1.5 text-left text-2xs tracking-wide text-faint">
                {t(group.title)}
              </p>
              <div className={`grid ${group.colsClass} gap-2`}>
                {group.roles.map((role) => (
                  <DemoButton
                    key={role}
                    d={DEMO_BY_ROLE[role]}
                    busy={busy}
                    onSelect={demoLogin}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-2xs text-faint">
          <ShieldCheck className="h-3.5 w-3.5" />
          {t("Защищённый доступ · только для сотрудников ДЧС")}
        </p>
      </div>
    </main>
  );
}
