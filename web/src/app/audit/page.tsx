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
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { intlLocale, useLocale, useT } from "@/lib/i18n";
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
  detail: Record<string, unknown> | null;
};
type AuditData = {
  total: number;
  matched: number;
  offset: number;
  limit: number;
  failed_logins: number;
  events: AuditEvent[];
};

/** Компактная строка из detail (JSONB) — «что именно» произошло, не только
 * факт запроса. Разные действия кладут разные поля, поэтому рендерим как
 * произвольный набор key: value, а не как жёсткую схему. */
function formatDetail(detail: Record<string, unknown> | null): string {
  if (!detail) return "";
  // Вложенные объекты обязаны разворачиваться: часть действий кладёт в detail
  // не плоские значения, а структуру — переназначение выезда пишет {from,to},
  // правка машины — {changes}, расход — {items}. String() превращал их в
  // «[object Object]», и запись в журнале переставала что-либо доказывать.
  const render = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) return v.map(render).join(",");
    if (typeof v === "object") {
      return `{${Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== null && x !== undefined && x !== "")
        .map(([k, x]) => `${k}=${render(x)}`)
        .join(", ")}}`;
    }
    return String(v);
  };
  return Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${render(v)}`)
    .join(" · ");
}

const ACTION_LABEL: Record<string, string> = {
  "login.success": "Успешный вход",
  "login.failed": "Неудачный вход",
  "read.card": "Просмотр карточки (ПДн)",
  "read.card_file": "Скачивание файла (ПДн)",
  "read.building": "Просмотр объекта",
  "chat.query": "AI-аналитик: запрос",
  "chat.query.failed": "AI-аналитик: отклонён",
};
const ACTION_OPTIONS = [
  "",
  "login.success",
  "login.failed",
  "read.card",
  "read.card_file",
  "read.building",
  "chat.query",
  "chat.query.failed",
];
const LIMITS = [50, 100, 200, 500];

/** Severity of an event: status code first, then action semantics. */
function eventSeverity(e: AuditEvent): SeverityMeta {
  const s = e.status_code ?? 0;
  if (s >= 500 || e.action === "login.failed") return SEVERITY.critical;
  if (s >= 400 || e.action === "chat.query.failed") return SEVERITY.high;
  if (e.method === "DELETE") return SEVERITY.high;
  // Reads of personal data are notable for accountability, not errors.
  if (e.action === "read.card" || e.action === "read.card_file") return SEVERITY.elevated;
  if (e.action === "login.success") return SEVERITY.normal;
  return SEVERITY.info;
}

function actionLabel(a: string): string {
  return ACTION_LABEL[a] ?? a;
}

function fmtTime(iso: string, locale: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString(locale, { day: "2-digit", month: "short" }),
    time: d.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  };
}

export default function AuditPage() {
  const t = useT();
  const { locale } = useLocale();
  const [data, setData] = useState<AuditData | null>(null);
  const [error, setError] = useState<{ code: number; msg: string } | null>(null);
  const [updated, setUpdated] = useState("");

  // applied filters
  const [action, setAction] = useState("");
  const [username, setUsername] = useState("");
  const [limit, setLimit] = useState(100);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [offset, setOffset] = useState(0);
  // username input is separate so typing doesn't refetch each keystroke
  const [userInput, setUserInput] = useState("");

  /** Меняет фильтр и сбрасывает страницу на первую — иначе после сужения
   * выборки offset может указывать за её пределы. */
  const applyFilter = useCallback((fn: () => void) => {
    fn();
    setOffset(0);
  }, []);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (action) qs.set("action", action);
    if (username) qs.set("username", username);
    if (dateFrom) qs.set("date_from", dateFrom);
    if (dateTo) qs.set("date_to", dateTo);
    setError(null);
    apiFetch(`/audit?${qs.toString()}`)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw {
            code: r.status,
            msg: (d as { detail?: string }).detail || t("Ошибка"),
          };
        }
        return r.json();
      })
      .then((d: AuditData) => {
        setData(d);
        setUpdated(
          new Date().toLocaleTimeString(intlLocale(locale), {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
      })
      .catch((e) =>
        setError({ code: e.code ?? 0, msg: e.msg ?? t("Сервис недоступен") }),
      );
  }, [action, username, limit, offset, dateFrom, dateTo, locale, t]);

  useEffect(() => {
    load();
  }, [load]);

  const loading = !data && !error;
  const forbidden = error?.code === 403;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title={t("Журнал аудита")}
          subtitle={t("Кто, что и когда делал в системе — подотчётность для ДЧС")}
          actions={
            <>
              <LiveIndicator updated={updated} className="hidden sm:inline-flex" />
              <Button
                variant="secondary"
                size="sm"
                onClick={load}
                aria-label={t("Обновить")}
              >
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline">{t("Обновить")}</span>
              </Button>
            </>
          }
        />

        {forbidden ? (
          <EmptyState
            className="mt-8"
            tone="error"
            icon={Lock}
            title={t("Доступ ограничен")}
            description={t("Журнал аудита доступен только руководству ведомства и администраторам.")}
          />
        ) : error ? (
          <EmptyState
            className="mt-8"
            tone="error"
            icon={ServerCrash}
            title={t("Журнал недоступен")}
            description={error.msg}
            action={
              <Button variant="secondary" size="sm" onClick={load}>
                <RefreshCw className="h-4 w-4" /> {t("Повторить")}
              </Button>
            }
          />
        ) : (
          <>
            {/* Summary */}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MetricCard
                label={t("Всего событий")}
                value={data ? data.total.toLocaleString(intlLocale(locale)) : "—"}
                icon={ScrollText}
                loading={loading}
                hint={t("за всё время")}
              />
              <MetricCard
                label={t("Неудачных входов")}
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
                    ? t("проверьте попытки подбора")
                    : t("подозрительной активности нет")
                }
              />
              <MetricCard
                label={t("Показано записей")}
                value={data ? data.events.length : "—"}
                icon={FileClock}
                loading={loading}
                hint={`${t("лимит выборки")} ${limit}`}
              />
            </div>

            {/* Filters */}
            <Card className="mt-5 p-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  applyFilter(() => setUsername(userInput.trim()));
                }}
                className="flex flex-wrap items-end gap-3"
              >
                <Field label={t("Пользователь")} className="min-w-[12rem] flex-1">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                    <Input
                      value={userInput}
                      onChange={(e) => setUserInput(e.target.value)}
                      placeholder={t("Логин (Enter — найти)")}
                      className="pl-8"
                      aria-label={t("Фильтр по пользователю")}
                    />
                  </div>
                </Field>
                <Field label={t("Действие")}>
                  <Select
                    value={action}
                    onChange={(e) => applyFilter(() => setAction(e.target.value))}
                    className="w-48"
                  >
                    {ACTION_OPTIONS.map((a) => (
                      <option key={a} value={a}>
                        {a === "" ? t("Все действия") : t(actionLabel(a))}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("Дата с")}>
                  <Input
                    type="date"
                    value={dateFrom}
                    max={dateTo || undefined}
                    onChange={(e) => applyFilter(() => setDateFrom(e.target.value))}
                    className="w-36"
                    aria-label={t("Дата с")}
                  />
                </Field>
                <Field label={t("Дата по")}>
                  <Input
                    type="date"
                    value={dateTo}
                    min={dateFrom || undefined}
                    onChange={(e) => applyFilter(() => setDateTo(e.target.value))}
                    className="w-36"
                    aria-label={t("Дата по")}
                  />
                </Field>
                <Field label={t("Лимит")}>
                  <Select
                    value={limit}
                    onChange={(e) => applyFilter(() => setLimit(Number(e.target.value)))}
                    className="w-24"
                  >
                    {LIMITS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button type="submit" variant="secondary">
                  <Search className="h-4 w-4" /> {t("Найти")}
                </Button>
              </form>
            </Card>

            {/* Events */}
            <Card className="mt-5 overflow-hidden p-0">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <ShieldCheck className="h-4 w-4 text-faint" />
                <SectionLabel>{t("События · от новых к старым")}</SectionLabel>
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
                  title={t("Событий не найдено")}
                  description={t("По текущим фильтрам записей нет. Измените условия выборки.")}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-faint">
                        <th className="px-4 py-2 font-medium">{t("Время")}</th>
                        <th className="px-4 py-2 font-medium">{t("Пользователь")}</th>
                        <th className="px-4 py-2 font-medium">{t("Действие")}</th>
                        <th className="hidden px-4 py-2 font-medium md:table-cell">
                          {t("Запрос")}
                        </th>
                        <th className="px-4 py-2 text-right font-medium">{t("Код")}</th>
                        <th className="hidden px-4 py-2 text-right font-medium lg:table-cell">
                          IP
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.events.map((e) => {
                        const sev = eventSeverity(e);
                        const et = fmtTime(e.ts, intlLocale(locale));
                        const isLogin =
                          e.action.startsWith("login") ||
                          e.action.startsWith("read.") ||
                          e.action.startsWith("chat.");
                        return (
                          <tr
                            key={e.id}
                            className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2/50"
                          >
                            <td className="whitespace-nowrap px-4 py-2.5">
                              <span className="tabular text-fg">{et.time}</span>
                              <span className="ml-2 tabular text-2xs text-faint">
                                {et.date}
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
                                label={t(actionLabel(e.action))}
                                icon={isLogin}
                              />
                            </td>
                            <td className="hidden max-w-[22rem] px-4 py-2.5 md:table-cell">
                              <div className="truncate">
                                {e.method && (
                                  <span className="mono mr-2 rounded bg-surface-3 px-1.5 py-0.5 text-2xs text-muted">
                                    {e.method}
                                  </span>
                                )}
                                <span className="mono text-xs text-muted">
                                  {e.path ?? "—"}
                                </span>
                              </div>
                              {e.detail && (
                                <div
                                  className="mt-0.5 truncate text-2xs text-faint"
                                  title={formatDetail(e.detail)}
                                >
                                  {formatDetail(e.detail)}
                                </div>
                              )}
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
              {data && data.matched > 0 && (
                <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
                  <span className="text-2xs text-faint">
                    <span className="tabular">{offset + 1}</span>
                    {"–"}
                    <span className="tabular">{offset + data.events.length}</span>{" "}
                    {t("из")}{" "}
                    <span className="tabular">
                      {data.matched.toLocaleString(intlLocale(locale))}
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setOffset((o) => Math.max(0, o - limit))}
                      disabled={offset === 0}
                      aria-label={t("Предыдущая страница")}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setOffset((o) => o + limit)}
                      disabled={offset + data.events.length >= data.matched}
                      aria-label={t("Следующая страница")}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>

            <p className="mt-3 flex items-center gap-1.5 text-2xs text-faint">
              <LogIn className="h-3 w-3" />
              {t("Записываются входы, изменяющие операции, чтение персональных данных (карточки, объекты) и запросы AI-аналитика. Журнал неизменяем (append-only, WORM).")}
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
