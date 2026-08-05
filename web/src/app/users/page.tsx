"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Users,
  UserPlus,
  UserX,
  UserCheck,
  KeyRound,
  RefreshCw,
  Lock,
  ServerCrash,
  ShieldCheck,
  ShieldOff,
  MapPin,
  X,
  Check,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch, useAuth, type Role } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/nav";
import { intlLocale, useLocale, useT } from "@/lib/i18n";
import { SEVERITY } from "@/lib/risk";
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
  Banner,
} from "@/components/ui";

type UserRow = {
  id: number;
  username: string;
  name: string;
  role: Role;
  district: string | null;
  is_active: boolean;
  created_at: string;
  disabled_at: string | null;
  disabled_by: string | null;
  /** Строка реестра инспекторов, привязанная к учётной записи (FK). */
  inspector_id: number | null;
  building_count: number;
};

type UsersData = {
  users: UserRow[];
  roles: Role[];
  districts: string[];
};

/** Роли, у которых район — граница доступа. Зеркалит DISTRICT_SCOPED_ROLES
 *  в api/app/routers/auth.py: для них район в форме обязателен. */
const DISTRICT_ROLES: Role[] = ["inspector", "supervisor"];

const EMPTY_FORM = {
  username: "",
  name: "",
  role: "inspector" as Role,
  district: "",
  password: "",
  buildingIds: "",
};

/** Текст ошибки из ответа FastAPI: строка `detail` либо список ошибок валидации. */
function errText(payload: unknown, fallback: string): string {
  const detail = (payload as { detail?: unknown })?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (d as { msg?: string }).msg)
      .filter(Boolean)
      .map((m) => String(m).replace(/^Value error,\s*/, ""));
    if (msgs.length) return msgs.join("; ");
  }
  return fallback;
}

function fmtDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function UsersPage() {
  const t = useT();
  const { locale } = useLocale();
  const { user: me } = useAuth();

  const [data, setData] = useState<UsersData | null>(null);
  const [error, setError] = useState<{ code: number; msg: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "critical"; msg: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Форма приёма сотрудника и инлайн-форма сброса пароля.
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [pwValue, setPwValue] = useState("");

  const load = useCallback(() => {
    setError(null);
    apiFetch("/auth/users")
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw { code: r.status, msg: errText(d, t("Ошибка")) };
        }
        return r.json();
      })
      .then((d: UsersData) => setData(d))
      .catch((e) =>
        setError({ code: e.code ?? 0, msg: e.msg ?? t("Сервис недоступен") }),
      );
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  /** Общий вызов действия над учёткой: показывает результат и перезагружает список. */
  const act = useCallback(
    async (key: string, path: string, body: unknown, okMsg: string) => {
      setBusy(key);
      setNotice(null);
      try {
        const r = await apiFetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) {
          setNotice({ tone: "critical", msg: errText(payload, t("Не удалось выполнить действие")) });
          return false;
        }
        setNotice({ tone: "info", msg: okMsg });
        load();
        return true;
      } catch {
        setNotice({ tone: "critical", msg: t("Сервис недоступен") });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [load, t],
  );

  const needsDistrict = DISTRICT_ROLES.includes(form.role);
  const isOwner = form.role === "owner";

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      username: form.username.trim(),
      password: form.password,
      name: form.name.trim(),
      role: form.role,
    };
    if (needsDistrict) body.district = form.district;
    if (isOwner) {
      body.building_ids = form.buildingIds
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    }
    const ok = await act(
      "create",
      "/auth/users",
      body,
      `${t("Учётная запись заведена")}: ${form.username.trim()}`,
    );
    if (ok) {
      setForm(EMPTY_FORM);
      setFormOpen(false);
    }
  }

  const loading = !data && !error;
  const forbidden = error?.code === 403;
  const total = data?.users.length ?? 0;
  const active = data?.users.filter((u) => u.is_active).length ?? 0;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title={t("Пользователи")}
          subtitle={t("Учётные записи сотрудников: приём, отключение доступа и смена пароля")}
          actions={
            <>
              <Button variant="secondary" size="sm" onClick={load} aria-label={t("Обновить")}>
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline">{t("Обновить")}</span>
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setFormOpen((o) => !o);
                  setNotice(null);
                }}
                aria-expanded={formOpen}
                disabled={!!forbidden}
              >
                <UserPlus className="h-4 w-4" />
                <span className="hidden sm:inline">{t("Завести сотрудника")}</span>
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
            description={t("Управление учётными записями доступно только администратору.")}
          />
        ) : error ? (
          <EmptyState
            className="mt-8"
            tone="error"
            icon={ServerCrash}
            title={t("Список пользователей недоступен")}
            description={error.msg}
            action={
              <Button variant="secondary" size="sm" onClick={load}>
                <RefreshCw className="h-4 w-4" /> {t("Повторить")}
              </Button>
            }
          />
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MetricCard
                label={t("Всего учётных записей")}
                value={loading ? "—" : total}
                icon={Users}
                loading={loading}
              />
              <MetricCard
                label={t("Действующих")}
                value={loading ? "—" : active}
                icon={ShieldCheck}
                severity={SEVERITY.normal}
                loading={loading}
                hint={t("могут войти в систему")}
              />
              <MetricCard
                label={t("Отключённых")}
                value={loading ? "—" : total - active}
                icon={ShieldOff}
                severity={total - active > 0 ? SEVERITY.elevated : undefined}
                loading={loading}
                hint={t("вход по паролю закрыт")}
              />
            </div>

            {notice && (
              <Banner
                className="mt-5"
                tone={notice.tone}
                title={notice.tone === "critical" ? t("Не выполнено") : t("Готово")}
              >
                {notice.msg}
              </Banner>
            )}

            {formOpen && (
              <Card className="mt-5 p-4 sm:p-5">
                <div className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-faint" />
                  <SectionLabel>{t("Приём сотрудника")}</SectionLabel>
                </div>
                <form
                  onSubmit={submitCreate}
                  className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                >
                  <Field label={t("Логин")}>
                    <Input
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      placeholder="a.serikov"
                      pattern="[a-z0-9_.\-]{3,50}"
                      title={t("Латиница в нижнем регистре, цифры, точка, дефис, подчёркивание")}
                      required
                    />
                  </Field>
                  <Field label={t("ФИО")}>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder={t("Сериков А.Б.")}
                      required
                    />
                  </Field>
                  <Field label={t("Роль")}>
                    <Select
                      value={form.role}
                      onChange={(e) =>
                        setForm({ ...form, role: e.target.value as Role, district: "" })
                      }
                    >
                      {(data?.roles ?? []).map((r) => (
                        <option key={r} value={r}>
                          {t(ROLE_LABEL[r])}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {needsDistrict && (
                    <Field label={t("Район")}>
                      <Select
                        value={form.district}
                        onChange={(e) => setForm({ ...form, district: e.target.value })}
                        required
                      >
                        <option value="">{t("Выберите район")}</option>
                        {(data?.districts ?? []).map((d) => (
                          <option key={d} value={d}>
                            {t(d)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  {isOwner && (
                    <Field label={t("Объекты (ID через запятую)")}>
                      <Input
                        value={form.buildingIds}
                        onChange={(e) => setForm({ ...form, buildingIds: e.target.value })}
                        placeholder="1204, 1205"
                        inputMode="numeric"
                        required
                      />
                    </Field>
                  )}
                  <Field label={t("Пароль")}>
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      minLength={8}
                      autoComplete="new-password"
                      placeholder={t("не менее 8 символов")}
                      required
                    />
                  </Field>
                  <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
                    <Button type="submit" disabled={busy === "create"}>
                      <UserPlus className="h-4 w-4" />
                      {busy === "create" ? t("Заводим…") : t("Завести")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setFormOpen(false);
                        setForm(EMPTY_FORM);
                      }}
                    >
                      {t("Отмена")}
                    </Button>
                  </div>
                </form>
                <p className="mt-3 text-2xs text-faint">
                  {t("Инспектор одновременно заводится в реестре инспекторов — иначе он не получит доступ к собственному маршруту. Общегородские роли (руководство, администратор, диспетчер, начальник караула) района не имеют.")}
                </p>
              </Card>
            )}

            <Card className="mt-5 overflow-hidden p-0">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <Users className="h-4 w-4 text-faint" />
                <SectionLabel>{t("Учётные записи · сначала действующие")}</SectionLabel>
              </div>

              {loading ? (
                <div className="divide-y divide-border">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-3">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="ml-auto h-4 w-24" />
                    </div>
                  ))}
                </div>
              ) : !data || data.users.length === 0 ? (
                <EmptyState
                  className="m-4 border-0 bg-transparent"
                  icon={Users}
                  title={t("Учётных записей нет")}
                  description={t("Заведите первого сотрудника — кнопка «Завести сотрудника» выше.")}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-faint">
                        <th className="px-4 py-2 font-medium">{t("Логин")}</th>
                        <th className="px-4 py-2 font-medium">{t("ФИО")}</th>
                        <th className="px-4 py-2 font-medium">{t("Роль")}</th>
                        <th className="hidden px-4 py-2 font-medium xl:table-cell">
                          {t("Район")}
                        </th>
                        <th className="px-4 py-2 font-medium">{t("Статус")}</th>
                        <th className="hidden px-4 py-2 font-medium 2xl:table-cell">
                          {t("Заведён")}
                        </th>
                        <th className="px-4 py-2 text-right font-medium">{t("Действия")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.users.map((u) => {
                        const self = me?.username === u.username;
                        const rowBusy = busy === u.username;
                        return (
                          <tr key={u.id} className="border-b border-border/60 last:border-0">
                            <td className="whitespace-nowrap px-4 py-2.5 align-top">
                              <span className="mono text-xs text-fg">{u.username}</span>
                              {self && (
                                <Badge tone="accent" className="ml-2 text-2xs">
                                  {t("вы")}
                                </Badge>
                              )}
                            </td>
                            <td className="px-4 py-2.5 align-top text-fg">
                              {u.name}
                              {u.inspector_id !== null && (
                                <span className="ml-2 tabular text-2xs text-faint">
                                  {t("реестр")} #{u.inspector_id}
                                </span>
                              )}
                              {u.role === "owner" && (
                                <span className="ml-2 tabular text-2xs text-faint">
                                  {u.building_count} {t("об.")}
                                </span>
                              )}
                              {/* Узкий экран: колонка «Район» скрыта — показываем
                                  район здесь, чтобы граница доступа оставалась видимой. */}
                              <span className="mt-0.5 flex items-center gap-1 text-2xs text-faint xl:hidden">
                                <MapPin className="h-3 w-3" aria-hidden />
                                {u.district ? t(u.district) : t("весь город")}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 align-top">
                              <Badge>{t(ROLE_LABEL[u.role])}</Badge>
                            </td>
                            <td className="hidden whitespace-nowrap px-4 py-2.5 align-top xl:table-cell">
                              {u.district ? (
                                <span className="inline-flex items-center gap-1.5 text-muted">
                                  <MapPin className="h-3.5 w-3.5 text-faint" aria-hidden />
                                  {t(u.district)}
                                </span>
                              ) : (
                                <span className="text-faint">{t("весь город")}</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 align-top">
                              <StatusChip
                                severity={u.is_active ? SEVERITY.normal : SEVERITY.elevated}
                                label={u.is_active ? t("Действует") : t("Отключена")}
                              />
                              {!u.is_active && u.disabled_by && (
                                <div className="mt-1 text-2xs text-faint">
                                  {t("отключил")} {u.disabled_by},{" "}
                                  <span className="tabular">
                                    {fmtDate(u.disabled_at, intlLocale(locale))}
                                  </span>
                                </div>
                              )}
                            </td>
                            <td className="hidden whitespace-nowrap px-4 py-2.5 align-top 2xl:table-cell">
                              <span className="tabular text-xs text-muted">
                                {fmtDate(u.created_at, intlLocale(locale))}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 align-top text-right">
                              <div className="inline-flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={rowBusy}
                                  onClick={() => {
                                    setPwFor(pwFor === u.username ? null : u.username);
                                    setPwValue("");
                                    setNotice(null);
                                  }}
                                  aria-expanded={pwFor === u.username}
                                  aria-label={`${t("Сбросить пароль")}: ${u.username}`}
                                  title={t("Сбросить пароль")}
                                >
                                  <KeyRound className="h-3.5 w-3.5" />
                                  <span className="hidden xl:inline">{t("Пароль")}</span>
                                </Button>
                                {u.is_active ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={self || rowBusy}
                                    aria-label={`${t("Отключить")}: ${u.username}`}
                                    title={
                                      self
                                        ? t("Нельзя отключить собственную учётную запись")
                                        : t("Отключить")
                                    }
                                    className="text-critical hover:bg-critical-bg"
                                    onClick={() => {
                                      if (
                                        !window.confirm(
                                          `${t("Отключить учётную запись")} «${u.username}»? ${t("Сотрудник не сможет войти ни старым токеном, ни по паролю. Включить обратно можно здесь же.")}`,
                                        )
                                      )
                                        return;
                                      act(
                                        u.username,
                                        `/auth/users/${encodeURIComponent(u.username)}/disable`,
                                        {},
                                        `${t("Доступ закрыт")}: ${u.username}`,
                                      );
                                    }}
                                  >
                                    <UserX className="h-3.5 w-3.5" />
                                    <span className="hidden xl:inline">{t("Отключить")}</span>
                                  </Button>
                                ) : (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={rowBusy}
                                    aria-label={`${t("Включить")}: ${u.username}`}
                                    title={t("Включить")}
                                    onClick={() =>
                                      act(
                                        u.username,
                                        `/auth/users/${encodeURIComponent(u.username)}/enable`,
                                        {},
                                        `${t("Доступ восстановлен")}: ${u.username}`,
                                      )
                                    }
                                  >
                                    <UserCheck className="h-3.5 w-3.5" />
                                    <span className="hidden xl:inline">{t("Включить")}</span>
                                  </Button>
                                )}
                              </div>

                              {pwFor === u.username && (
                                <form
                                  className="mt-2 flex items-center justify-end gap-2"
                                  onSubmit={async (e) => {
                                    e.preventDefault();
                                    const ok = await act(
                                      u.username,
                                      `/auth/users/${encodeURIComponent(u.username)}/password`,
                                      { password: pwValue },
                                      `${t("Пароль изменён, сессии завершены")}: ${u.username}`,
                                    );
                                    if (ok) {
                                      setPwFor(null);
                                      setPwValue("");
                                    }
                                  }}
                                >
                                  <Input
                                    type="password"
                                    value={pwValue}
                                    onChange={(e) => setPwValue(e.target.value)}
                                    minLength={8}
                                    required
                                    autoComplete="new-password"
                                    placeholder={t("новый пароль")}
                                    aria-label={`${t("Новый пароль")} ${u.username}`}
                                    className="w-44"
                                  />
                                  <Button type="submit" size="sm" disabled={rowBusy}>
                                    <Check className="h-3.5 w-3.5" />
                                    {t("Сменить")}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setPwFor(null)}
                                    aria-label={t("Отмена")}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </form>
                              )}
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
              <ShieldOff className="h-3 w-3" />
              {t("Отключение закрывает и активные сессии, и вход по паролю; учётная запись не удаляется, чтобы сохранить авторство актов и записей журнала аудита. Все действия над учётными записями пишутся в журнал аудита.")}
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
