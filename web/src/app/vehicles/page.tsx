"use client";

/**
 * Силы и техника — учёт машин по частям и сводка выездов.
 *
 * Зачем это существует: расчёт сил и средств предлагает N отделений, ничего
 * не зная о том, есть ли они физически в строю. Без этого учёта рекомендация
 * остаётся теоретической — диспетчер всё равно уточняет наличие по радио.
 *
 * Скоупинг: начальник караула ведёт технику своей части (проверка на сервере,
 * `users.station_id`), диспетчер и админ — по всему городу. Надзорные роли
 * (supervisor/leadership) видят обе вкладки только на чтение: состояние
 * техники — это оперативная информация, а не предмет надзорных решений.
 */
import { useMemo, useState } from "react";
import {
  Truck,
  Plus,
  Trash2,
  BarChart3,
  Timer,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import {
  PageHeader,
  Card,
  SectionLabel,
  Button,
  Badge,
  StatusChip,
  Banner,
  EmptyState,
  Skeleton,
  MetricCard,
  Tabs,
  Field,
  Input,
  Select,
} from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { SEVERITY } from "@/lib/risk";
import {
  VEHICLE_TYPES,
  VEHICLE_STATUSES,
  VEHICLE_TYPE_META,
  VEHICLE_STATUS_META,
  RESOURCE_META,
  CALLOUT_TYPE_META,
  formatDuration,
  useVehicles,
  useDispatchStats,
  createVehicle,
  patchVehicle,
  deleteVehicle,
  type VehicleType,
  type VehicleStatus,
  type Vehicle,
} from "@/lib/dispatch";

const POLL_MS = 30000;
/** Норматив прибытия в городской черте — 10 минут. */
const RESPONSE_NORM_SEC = 600;

export default function VehiclesPage() {
  const t = useT();
  const { user } = useAuth();
  const [tab, setTab] = useState("fleet");

  // Диспетчер и админ распределяют силы по городу — правят любую часть.
  // Начальник караула ведёт технику ТОЛЬКО своей части: он относится к одной
  // части, и сервер это подтверждает 403-м на чужую. Видит он при этом весь
  // город — как РТП ему нужно знать, откуда идёт подкрепление.
  const citywideEdit = user?.role === "dispatcher" || user?.role === "admin";
  const ownStationId = user?.role === "responder" ? (user.station?.id ?? null) : null;
  const canEdit = citywideEdit || ownStationId !== null;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title={t("Силы и техника")}
          subtitle={t(
            "Состояние машин по частям и сводка выездов — чем расчёт сил обеспечен фактически",
          )}
        />

        <Tabs
          className="mt-5"
          tabs={[
            { id: "fleet", label: t("Техника частей") },
            { id: "stats", label: t("Сводка выездов") },
          ]}
          active={tab}
          onChange={setTab}
        />

        <div className="mt-5">
          {tab === "fleet" ? (
            <FleetTab canEdit={canEdit} ownStationId={ownStationId} />
          ) : (
            <StatsTab />
          )}
        </div>
      </div>
    </AppShell>
  );
}

/* ─────────────────────────── Техника частей ─────────────────────────── */

function FleetTab({
  canEdit,
  ownStationId,
}: {
  canEdit: boolean;
  /** Не null только у начальника караула — тогда правится лишь эта часть. */
  ownStationId: number | null;
}) {
  const t = useT();
  const { data, error, reload } = useVehicles(null, POLL_MS);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [adding, setAdding] = useState<number | null>(null);

  const run = async (id: number, fn: () => Promise<unknown>) => {
    setBusy(id);
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Не удалось сохранить изменение"));
    } finally {
      setBusy(null);
    }
  };

  // Права на конкретную часть: диспетчер и админ правят любую (ownStationId
  // = null), начальник караула — только свою. Ровно та же граница, что и на
  // сервере (_assert_station_access), иначе интерфейс предлагал бы действие,
  // которое закончится 403.
  const canEditStation = (stationId: number) =>
    canEdit && (ownStationId === null || ownStationId === stationId);

  const totals = useMemo(() => {
    const all = data?.vehicles ?? [];
    return {
      total: all.length,
      in_service: all.filter((v) => v.status === "in_service").length,
      on_callout: all.filter((v) => v.status === "on_callout").length,
      repair: all.filter((v) => v.status === "repair").length,
    };
  }, [data]);

  if (error) return <Banner tone="critical">{error}</Banner>;
  if (!data)
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );

  // Частей нет вовсе — учёт вести негде: сначала импорт инфраструктуры.
  if (data.by_station.length === 0)
    return (
      <EmptyState
        icon={Truck}
        title={t("Пожарные части не загружены")}
        description={t(
          "В реестре нет ни одной части — сначала нужно загрузить инфраструктуру города.",
        )}
      />
    );

  return (
    <div className="space-y-5">
      {actionError && <Banner tone="critical">{actionError}</Banner>}

      {totals.total === 0 && (
        <Banner tone="warning">
          {t(
            "Ни в одной части нет техники на учёте. Пока её нет, расчёт сил не с чем сверять — добавьте машины в частях ниже.",
          )}
        </Banner>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label={t("Всего машин")} value={totals.total} icon={Truck} />
        <MetricCard
          label={t("В строю")}
          value={totals.in_service}
          severity={SEVERITY.normal}
        />
        <MetricCard
          label={t("На выезде")}
          value={totals.on_callout}
          severity={SEVERITY.elevated}
        />
        <MetricCard
          label={t("В ремонте")}
          value={totals.repair}
          severity={totals.repair > 0 ? SEVERITY.critical : undefined}
        />
      </div>

      {data.by_station.map((st) => {
        const vehicles = data.vehicles.filter((v) => v.station_id === st.station_id);
        return (
          <Card key={st.station_id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-fg">
                    {st.station_name ?? `${t("Часть")} #${st.station_id}`}
                  </span>
                  {ownStationId === st.station_id && (
                    <Badge tone="accent">{t("Ваша часть")}</Badge>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  <span>
                    {t("Всего")}: <span className="tabular text-fg">{st.total}</span>
                  </span>
                  {VEHICLE_STATUSES.map((s) =>
                    st[s] > 0 ? (
                      <span key={s}>
                        {t(VEHICLE_STATUS_META[s].label)}:{" "}
                        <span className="tabular text-fg">{st[s]}</span>
                      </span>
                    ) : null,
                  )}
                </div>
              </div>
              {canEditStation(st.station_id) && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setAdding((cur) => (cur === st.station_id ? null : st.station_id))
                  }
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  {t("Добавить машину")}
                </Button>
              )}
            </div>

            {st.in_service === 0 && st.total > 0 && (
              <Banner tone="critical" className="mt-3">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                {t("В части нет ни одной машины в строю — выезд обеспечивается соседними частями.")}
              </Banner>
            )}

            {adding === st.station_id && canEditStation(st.station_id) && (
              <AddVehicleForm
                stationId={st.station_id}
                onDone={() => {
                  setAdding(null);
                  reload();
                }}
                onError={setActionError}
              />
            )}

            {vehicles.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t("В части нет техники на учёте.")}</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-faint">
                      <th className="pb-2 pr-3 font-medium">{t("Позывной")}</th>
                      <th className="pb-2 pr-3 font-medium">{t("Тип")}</th>
                      <th className="pb-2 pr-3 font-medium">{t("Состояние")}</th>
                      <th className="pb-2 pr-3 text-right font-medium">{t("Вода, л")}</th>
                      {canEditStation(st.station_id) && <th className="pb-2 w-10" />}
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map((v) => (
                      <VehicleRow
                        key={v.id}
                        vehicle={v}
                        canEdit={canEditStation(st.station_id)}
                        busy={busy === v.id}
                        onStatus={(status) => run(v.id, () => patchVehicle(v.id, { status }))}
                        onDelete={() => run(v.id, () => deleteVehicle(v.id))}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function VehicleRow({
  vehicle,
  canEdit,
  busy,
  onStatus,
  onDelete,
}: {
  vehicle: Vehicle;
  canEdit: boolean;
  busy: boolean;
  onStatus: (s: VehicleStatus) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const meta = VEHICLE_STATUS_META[vehicle.status];

  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="py-2 pr-3 font-medium text-fg">{vehicle.callsign}</td>
      <td className="py-2 pr-3">
        <Badge>{t(VEHICLE_TYPE_META[vehicle.vehicle_type].short)}</Badge>
        <span className="ml-2 hidden text-xs text-faint sm:inline">
          {t(VEHICLE_TYPE_META[vehicle.vehicle_type].label)}
        </span>
      </td>
      <td className="py-2 pr-3">
        {canEdit ? (
          <Select
            aria-label={`${t("Состояние")}: ${vehicle.callsign}`}
            value={vehicle.status}
            disabled={busy}
            onChange={(e) => onStatus(e.target.value as VehicleStatus)}
            className="h-8 text-xs"
          >
            {VEHICLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(VEHICLE_STATUS_META[s].label)}
              </option>
            ))}
          </Select>
        ) : (
          <StatusChip severity={meta.severity} label={t(meta.label)} />
        )}
      </td>
      <td className="py-2 pr-3 text-right tabular text-muted">
        {vehicle.water_l ?? "—"}
      </td>
      {canEdit && (
        <td className="py-2 text-right">
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            disabled={busy}
            aria-label={`${t("Снять с учёта")}: ${vehicle.callsign}`}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </td>
      )}
    </tr>
  );
}

function AddVehicleForm({
  stationId,
  onDone,
  onError,
}: {
  stationId: number;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const t = useT();
  const [callsign, setCallsign] = useState("");
  const [type, setType] = useState<VehicleType>("ac");
  const [water, setWater] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!callsign.trim()) return;
    setSaving(true);
    try {
      await createVehicle(stationId, {
        callsign: callsign.trim(),
        vehicle_type: type,
        water_l: water ? Number(water) : null,
      });
      setCallsign("");
      setWater("");
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : t("Не удалось поставить машину на учёт"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 grid gap-3 rounded-md border border-border bg-surface-2 p-3 sm:grid-cols-4">
      <Field label={t("Позывной")}>
        <Input
          value={callsign}
          onChange={(e) => setCallsign(e.target.value)}
          placeholder={t("АЦ-1")}
          maxLength={32}
        />
      </Field>
      <Field label={t("Тип техники")}>
        <Select value={type} onChange={(e) => setType(e.target.value as VehicleType)}>
          {VEHICLE_TYPES.map((vt) => (
            <option key={vt} value={vt}>
              {t(VEHICLE_TYPE_META[vt].short)} — {t(VEHICLE_TYPE_META[vt].label)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("Ёмкость цистерны, л")}>
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          className="tabular"
          value={water}
          onChange={(e) => setWater(e.target.value)}
          placeholder="3000"
        />
      </Field>
      <div className="flex items-end">
        <Button onClick={submit} disabled={saving || !callsign.trim()} className="w-full">
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {t("Поставить на учёт")}
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────── Сводка выездов ─────────────────────────── */

function StatsTab() {
  const t = useT();
  const [days, setDays] = useState(30);
  const { stats, error } = useDispatchStats(days);

  if (error) return <Banner tone="critical">{error}</Banner>;

  const totalCallouts = stats?.by_station.reduce((s, r) => s + r.callouts, 0) ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel>{t("Период")}</SectionLabel>
        {[7, 30, 90, 365].map((d) => (
          <Button
            key={d}
            size="sm"
            variant={days === d ? "primary" : "secondary"}
            onClick={() => setDays(d)}
          >
            {d} {t("дн.")}
          </Button>
        ))}
      </div>

      {!stats ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : totalCallouts === 0 ? (
        <EmptyState
          icon={BarChart3}
          title={t("Выездов за период нет")}
          description={t("Сводка появится, как только диспетчер зарегистрирует первый выезд.")}
        />
      ) : (
        <>
          <Card className="p-4">
            <SectionLabel>
              <Timer className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
              {t("По частям")}
            </SectionLabel>
            <p className="mt-1 text-xs text-faint">
              {t(
                "Медиана, а не среднее: один затянувшийся выезд не должен искажать типичную картину.",
              )}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-faint">
                    <th className="pb-2 pr-3 font-medium">{t("Часть")}</th>
                    <th className="pb-2 pr-3 text-right font-medium">{t("Выездов")}</th>
                    <th className="pb-2 pr-3 text-right font-medium">{t("С отметкой прибытия")}</th>
                    <th className="pb-2 pr-3 text-right font-medium">{t("Медиана сбора")}</th>
                    <th className="pb-2 text-right font-medium">{t("Медиана прибытия")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.by_station.map((r) => {
                    const over =
                      r.median_response_sec != null && r.median_response_sec > RESPONSE_NORM_SEC;
                    return (
                      <tr key={r.station_id} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-3 text-fg">
                          {r.station_name ?? `#${r.station_id}`}
                        </td>
                        <td className="py-2 pr-3 text-right tabular">{r.callouts}</td>
                        <td className="py-2 pr-3 text-right tabular text-muted">
                          {r.with_arrival}
                        </td>
                        <td className="py-2 pr-3 text-right tabular text-muted">
                          {formatDuration(r.median_turnout_sec)}
                        </td>
                        <td
                          className={cn(
                            "py-2 text-right tabular",
                            over ? "font-medium text-critical" : "text-fg",
                          )}
                        >
                          {formatDuration(r.median_response_sec)}
                          {over && (
                            <AlertTriangle className="ml-1 inline h-3.5 w-3.5" aria-hidden />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-faint">
              {t("Красным — медиана прибытия свыше норматива 10 минут.")}
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <SectionLabel>{t("По типу вызова")}</SectionLabel>
              <ul className="mt-3 space-y-2">
                {stats.by_type.map((r) => {
                  const meta = CALLOUT_TYPE_META[r.callout_type];
                  const share = totalCallouts ? Math.round((r.count / totalCallouts) * 100) : 0;
                  return (
                    <li key={r.callout_type} className="flex items-center gap-3">
                      <StatusChip severity={meta.severity} label={t(meta.label)} />
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${share}%`, background: meta.severity.cssVar }}
                          aria-hidden
                        />
                      </div>
                      <span className="tabular text-sm text-fg">{r.count}</span>
                      <span className="w-10 text-right tabular text-xs text-faint">{share}%</span>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card className="p-4">
              <SectionLabel>{t("Израсходовано за период")}</SectionLabel>
              {stats.resources.length === 0 ? (
                <p className="mt-3 text-sm text-muted">
                  {t("Расход по выездам не вносился.")}
                </p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {stats.resources.map((r) => (
                    <li key={r.item_key} className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm text-muted">
                        {t(RESOURCE_META[r.item_key].label)}
                      </span>
                      <span className="tabular text-sm font-medium text-fg">
                        {r.total}{" "}
                        <span className="text-xs text-faint">
                          {t(RESOURCE_META[r.item_key].unit)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
