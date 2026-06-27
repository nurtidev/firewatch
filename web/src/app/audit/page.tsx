"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  Search,
  ScrollText,
  LogIn,
  Lock,
  ServerCrash,
  FileClock,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { SEVERITY, type SeverityMeta } from "@/lib/risk";
import {
  Card,
  PageHeader,
  MetricCard,
  SectionLabel,
  Button,
  Input,
  Select,
  Field,
  Skeleton,
  EmptyState,
  StatusChip,
  Badge,
  LiveIndicator,
} from "@/components/ui";

type AuditEvent = {
  id: number;
  ts: string;
  username: string | null;
  role: string | null;
  action: string;
  method: string | null;
  path: string | null;
  status_code: number | null;
  ip: string | null;
};
type AuditData = {
  total: number;
  failed_logins: number;
  events: AuditEvent[];
};

const ACTION_LABEL: Record<string, string> = {
  "login.success": "Успешный вход",
  "login.failed": "Неудачный вход",
};
const ACTION_OPTIONS = ["", "login.success", "login.failed"];
const LIMITS = [50, 100, 200, 500];

/** Severity of an event: status code first, then action semantics. */
function eventSeverity(e: AuditEvent): SeverityMeta {
  const s = e.status_code ?? 0;
  if (s >= 500 || e.action === "login.failed") return SEVERITY.critical;
  if (s >= 400) return SEVERITY.high;
  if (e.method === "DELETE") return SEVERITY.high;
  if (e.action === "login.success") return SEVERITY.normal;
  return SEVERITY.info;
}

function actionLabel(a: string): string {
  return ACTION_LABEL[a] ?? a;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("ru", { day: "2-digit", month: "short" }),
    time: d.toLocaleTimeString("ru", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  };
}

export default function AuditPage() {
  const [data, setData] = useState<AuditData | null>(null);
  const [error, setError] = useState<{ code: number; msg: string } | null>(null);
  const [updated, setUpdated] = useState("");

  // applied filters
  const [action, setAction] = useState("");
  const [username, setUsername] = useState("");
  const [limit, setLimit] = useState(100);
  // username input is separate so typing doesn't refetch each keystroke
  const [userInput, setUserInput] = useState("");

  const load = useCallback(() => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (action) qs.set("action", action);
    if (username) qs.set("username", username);
    setError(null);
    apiFetch(`/audit?${qs.toString()}`)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw {
            code: r.status,
            msg: (d as { detail?: string }).detail || "Ошибка",
          };
        }
        return r.json();
      })
      .then((d: AuditData) => {
        setData(d);
        setUpdated(
          new Date().toLocaleTimeString("ru", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
      })
      .catch((e) =>
        setError({ code: e.code ?? 0, msg: e.msg ?? "Сервис недоступен" }),
      );
  }, [action, username, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const loading = !data && !error;
  const forbidden = error?.code === 403;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title="Журнал аудита"
          subtitle="Кто, что и когда делал в системе — подотчётность для ДЧС"
          actions={
            <>
              <LiveIndicator updated={updated} className="hidden sm:inline-flex" />
              <Button
                variant="secondary"
                size="sm"
                onClick={load}
                aria-label="Обновить"
              >
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline">Обновить</span>
              </Button>
            </>
          }
        />

        {forbidden ? (
          <EmptyState
            className="mt-8"
            tone="error"
            icon={Lock}
            title="Доступ ограничен"
            description="Журнал аудита доступен только руководству ведомства и администраторам."
          />
        ) : error ? (
          <EmptyState
            className="mt-8"
            tone="error"
            icon={ServerCrash}
            title="Журнал недоступен"
            description={error.msg}
            action={
              <Button variant="secondary" size="sm" onClick={load}>
                <RefreshCw className="h-4 w-4" /> Повторить
              </Button>
            }
          />
        ) : (
          <>
            {/* Summary */}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MetricCard
                label="Всего событий"
                value={data ? data.total.toLocaleString("ru") : "—"}
                icon={ScrollText}
                loading={loading}
                hint="за всё время"
              />
              <MetricCard
                label="Неудачных входов"
                value={data?.failed_logins ?? "—"}
                icon={ShieldAlert}
                severity={
                  data && data.failed_logins > 0
                    ? SEVERITY.critical
                    : SEVERITY.normal
                }
                loading={loading}
                hint={
                  data && data.failed_logins > 0
                    ? "проверьте попытки подбора"
                    : "подозрительной активности нет"
                }
              />
              <MetricCard
                label="Показано записей"
                value={data ? data.events.length : "—"}
                icon={FileClock}
                loading={loading}
                hint={`лимит выборки ${limit}`}
              />
            </div>

            {/* Filters */}
            <Card className="mt-5 p-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setUsername(userInput.trim());
                }}
                className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
              >
                <Field label="Пользователь">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                    <Input
                      value={userInput}
                      onChange={(e) => setUserInput(e.target.value)}
                      placeholder="Логин (Enter — найти)"
                      className="pl-8"
                      aria-label="Фильтр по пользователю"
                    />
                  </div>
                </Field>
                <Field label="Действие">
                  <Select
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                    className="sm:w-48"
                  >
                    {ACTION_OPTIONS.map((a) => (
                      <option key={a} value={a}>
                        {a === "" ? "Все действия" : actionLabel(a)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Лимит">
                  <Select
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    className="sm:w-24"
                  >
                    {LIMITS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button type="submit" variant="secondary">
                  <Search className="h-4 w-4" /> Найти
                </Button>
              </form>
            </Card>

            {/* Events */}
            <Card className="mt-5 overflow-hidden p-0">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <ShieldCheck className="h-4 w-4 text-faint" />
                <SectionLabel>События · от новых к старым</SectionLabel>
              </div>

              {loading ? (
                <div className="divide-y divide-border">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-3">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="ml-auto h-4 w-12" />
                    </div>
                  ))}
                </div>
              ) : !data || data.events.length === 0 ? (
                <EmptyState
                  className="m-4 border-0 bg-transparent"
                  icon={FileClock}
                  title="Событий не найдено"
                  description="По текущим фильтрам записей нет. Измените условия выборки."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-faint">
                        <th className="px-4 py-2 font-medium">Время</th>
                        <th className="px-4 py-2 font-medium">Пользователь</th>
                        <th className="px-4 py-2 font-medium">Действие</th>
                        <th className="hidden px-4 py-2 font-medium md:table-cell">
                          Запрос
                        </th>
                        <th className="px-4 py-2 text-right font-medium">Код</th>
                        <th className="hidden px-4 py-2 text-right font-medium lg:table-cell">
                          IP
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.events.map((e) => {
                        const sev = eventSeverity(e);
                        const t = fmtTime(e.ts);
                        const isLogin = e.action.startsWith("login");
                        return (
                          <tr
                            key={e.id}
                            className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2/50"
                          >
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <span className="tabular text-fg">{t.time}</span>
                              <span className="ml-2 tabular text-2xs text-faint">
                                {t.date}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="text-fg">{e.username ?? "—"}</span>
                                {e.role && (
                                  <Badge className="text-2xs">{e.role}</Badge>
                                )}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <StatusChip
                                severity={sev}
                                label={actionLabel(e.action)}
                                icon={isLogin}
                              />
                            </td>
                            <td className="hidden max-w-[22rem] truncate px-4 py-2.5 md:table-cell">
                              {e.method && (
                                <span className="mono mr-2 rounded bg-surface-3 px-1.5 py-0.5 text-2xs text-muted">
                                  {e.method}
                                </span>
                              )}
                              <span className="mono text-xs text-muted">
                                {e.path ?? "—"}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right">
                              <span
                                className={cn(
                                  "tabular text-sm font-medium",
                                  (e.status_code ?? 0) >= 400
                                    ? sev.text
                                    : "text-muted",
                                )}
                              >
                                {e.status_code ?? "—"}
                              </span>
                            </td>
                            <td className="hidden whitespace-nowrap px-4 py-2.5 text-right lg:table-cell">
                              <span className="mono text-xs text-faint">
                                {e.ip ?? "—"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <p className="mt-3 flex items-center gap-1.5 text-2xs text-faint">
              <LogIn className="h-3 w-3" />
              Записываются все входы и изменяющие операции (POST/PUT/PATCH/DELETE).
              Запись аудита не блокирует бизнес-запрос.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
