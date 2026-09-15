"use client";

/**
 * Донесения о пожарах — закрытые выезды и печатные донесения.
 *
 * «Боевой выезд» (/callout) показывает только активные вызовы — как только
 * диспетчер закрывает выезд, он выпадает из этого списка и печатное
 * донесение (/callout/report) становится доступно только по прямой ссылке
 * из уже закрытого пакета. Разбор задним числом (супервайзер сверяет время
 * прибытия за квартал, РТП ищет донесение по прошлому пожару) не имел входа
 * в интерфейс вовсе — только прямой URL, если он уже был кем-то сохранён.
 *
 * Роли — те же, что у бэкендового VIEW_ROLES в dispatch.py (диспетчер,
 * начальник караула, супервайзер, руководство, admin): именно они читают
 * список выездов и боевой пакет сегодня, архив — то же чтение по закрытым
 * выездам.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  Search,
  FileText,
  Package,
  ChevronLeft,
  ChevronRight,
  MapPin,
  CalendarDays,
  RefreshCw,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/auth";
import { useT, useLocale, intlLocale } from "@/lib/i18n";
import { SEVERITY } from "@/lib/risk";
import { cn } from "@/lib/cn";
import {
  Card,
  PageHeader,
  SectionLabel,
  Button,
  LinkButton,
  Field,
  Select,
  Input,
  Skeleton,
  EmptyState,
  Banner,
  StatusChip,
} from "@/components/ui";
import {
  CALLOUT_TYPES,
  CALLOUT_TYPE_META,
  LATE_SYNC_ICON,
  formatDuration,
  type CalloutType,
} from "@/lib/dispatch";

const PAGE_SIZE = 20;
const PERIODS = [7, 30, 90] as const;
// Тот же значок, что у CalloutRow.tsx для этой пометки.
const LateSyncIcon = LATE_SYNC_ICON;

/** Минимизированная строка архива (см. `_archive_dict` в dispatch.py) — не
 *  полный `Callout`: архив читается по всему городу и ищется текстом, поэтому
 *  сервер отдаёт только то, что эта страница показывает (плюс id для ссылок
 *  «Донесение»/«Пакет»), без текста сообщения, комментария закрытия и логинов.
 *  `late_sync` — то же поле и та же форма, что у полного `Callout`
 *  (lib/dispatch.ts) — досинхронизация с планшета уже после закрытия выезда. */
type ArchiveCallout = {
  id: number;
  address: string | null;
  district: string | null;
  callout_type: CalloutType;
  status: "active" | "closed";
  lat: number;
  lng: number;
  created_at: string | null;
  rank_declared: string | null;
  response_sec: number | null;
  late_sync?: { positions: number; removed?: number; last_synced_at: string | null } | null;
};

type ArchiveResponse = {
  matched: number;
  offset: number;
  limit: number;
  callouts: ArchiveCallout[];
};

type StationOption = { station_id: number; station_name: string | null };

export default function CalloutArchivePage() {
  const t = useT();
  const { locale } = useLocale();

  const [days, setDays] = useState<number | null>(null);
  const [stationId, setStationId] = useState<number | null>(null);
  const [calloutType, setCalloutType] = useState<CalloutType | "">("");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [offset, setOffset] = useState(0);

  const [stations, setStations] = useState<StationOption[]>([]);
  const [data, setData] = useState<ArchiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Растущий id запроса: ответ применяется, только если он всё ещё последний
  // отправленный — иначе быстрая смена фильтра/страницы даёт ответу за #1
  // прийти позже ответа за #2 и перезаписать актуальные данные устаревшими
  // (та же защита, что у useCalloutPack в lib/dispatch.ts).
  const requestIdRef = useRef(0);

  // Список частей для фильтра — берём из справочника техники (тот же
  // VIEW_ROLES), а не заводим отдельный эндпоинт ради имён.
  useEffect(() => {
    apiFetch(`/dispatch/vehicles`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { by_station?: StationOption[] } | null) => {
        if (d?.by_station) setStations(d.by_station);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    const requestId = ++requestIdRef.current;
    const qs = new URLSearchParams({
      status: "closed",
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (days != null) qs.set("days", String(days));
    if (stationId != null) qs.set("station_id", String(stationId));
    if (calloutType) qs.set("callout_type", calloutType);
    if (q) qs.set("q", q);
    setLoading(true);
    apiFetch(`/dispatch/archive?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("archive"))))
      .then((d: ArchiveResponse) => {
        if (requestIdRef.current !== requestId) return; // ответ устарел
        setData(d);
        setError(null);
        setLoading(false);
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        // Ошибку показываем всегда, даже если на экране ещё лежат строки
        // предыдущей успешной страницы: иначе неудачный переход на
        // страницу 2 молча оставляет строки страницы 1 под подписью
        // «21–40 из N» — расхождение видно только по счёту, не по тексту.
        setError(t("Не удалось загрузить выезды. Проверьте связь."));
        setLoading(false);
      });
  }, [days, stationId, calloutType, q, offset, t]);

  useEffect(() => {
    load();
  }, [load]);

  /** Меняет фильтр и сбрасывает страницу на первую — иначе после сужения
   *  выборки offset может указывать за её пределы. */
  const applyFilter = (fn: () => void) => {
    fn();
    setOffset(0);
  };

  const fmtDateTime = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(intlLocale(locale), {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title={t("Донесения о пожарах")}
          subtitle={t("Закрытые выезды и печатные донесения о пожарах")}
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={load}
              disabled={loading}
              aria-label={t("Обновить")}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              <span className="hidden sm:inline">{t("Обновить")}</span>
            </Button>
          }
        />

        {/* Filters */}
        <Card className="mt-5 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              applyFilter(() => setQ(qInput.trim()));
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <Field label={t("Адрес")} className="min-w-[14rem] flex-1">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <Input
                  value={qInput}
                  onChange={(e) => setQInput(e.target.value)}
                  placeholder={t("Поиск по адресу (Enter — найти)")}
                  className="pl-8"
                  aria-label={t("Поиск по адресу")}
                  maxLength={100}
                />
              </div>
            </Field>
            <Field label={t("Период")}>
              <Select
                value={days ?? ""}
                onChange={(e) =>
                  applyFilter(() => setDays(e.target.value ? Number(e.target.value) : null))
                }
                className="w-36"
              >
                <option value="">{t("Всё время")}</option>
                {PERIODS.map((d) => (
                  <option key={d} value={d}>
                    {d} {t("дн.")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("Часть")}>
              <Select
                value={stationId ?? ""}
                onChange={(e) =>
                  applyFilter(() => setStationId(e.target.value ? Number(e.target.value) : null))
                }
                className="w-44"
              >
                <option value="">{t("Все части")}</option>
                {stations.map((s) => (
                  <option key={s.station_id} value={s.station_id}>
                    {s.station_name ?? `#${s.station_id}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("Тип вызова")}>
              <Select
                value={calloutType}
                onChange={(e) =>
                  applyFilter(() => setCalloutType(e.target.value as CalloutType | ""))
                }
                className="w-40"
              >
                <option value="">{t("Все типы")}</option>
                {CALLOUT_TYPES.map((ct) => (
                  <option key={ct} value={ct}>
                    {t(CALLOUT_TYPE_META[ct].label)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="secondary" disabled={loading}>
              <Search className="h-4 w-4" /> {t("Найти")}
            </Button>
          </form>
        </Card>

        {/* Results */}
        <Card className="mt-5 overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Archive className="h-4 w-4 text-faint" />
            <SectionLabel>{t("Закрытые выезды · от новых к старым")}</SectionLabel>
          </div>

          {loading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="ml-auto h-4 w-24" />
                </div>
              ))}
            </div>
          ) : error ? (
            // Ошибку — вместо списка целиком, не поверх устаревших строк:
            // строки прошлой успешной страницы под текущими фильтрами/
            // офсетом ничего не доказывают, а подпись пагинации к ним не
            // подходит (см. комментарий в load()).
            <Banner tone="critical" className="m-4">
              {error}
            </Banner>
          ) : !data || data.callouts.length === 0 ? (
            <EmptyState
              className="m-4 border-0 bg-transparent"
              icon={Archive}
              title={t("Донесений в архиве нет")}
              description={t("Закрытых выездов по текущим фильтрам не найдено.")}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-faint">
                    <th className="px-4 py-2 font-medium">{t("Дата и время")}</th>
                    <th className="px-4 py-2 font-medium">{t("Адрес")}</th>
                    <th className="hidden px-4 py-2 font-medium sm:table-cell">
                      {t("Тип вызова")}
                    </th>
                    <th className="hidden px-4 py-2 font-medium md:table-cell">
                      {t("Ранг пожара")}
                    </th>
                    <th className="hidden px-4 py-2 text-right font-medium md:table-cell">
                      {t("Время прибытия")}
                    </th>
                    <th className="px-4 py-2 font-medium">{t("Статус")}</th>
                    <th className="px-4 py-2 text-right font-medium">{t("Действия")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.callouts.map((c) => {
                    const typeMeta = CALLOUT_TYPE_META[c.callout_type];
                    return (
                      <tr
                        key={c.id}
                        className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2/50"
                      >
                        <td className="whitespace-nowrap px-4 py-2.5 tabular text-fg">
                          {fmtDateTime(c.created_at)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
                            <span
                              className={cn("max-w-[18rem] truncate text-fg", !c.address && "tabular")}
                            >
                              {c.address || `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`}
                            </span>
                          </div>
                          {c.district && (
                            <span className="ml-5 text-2xs text-faint">
                              {c.district} {t("р-н")}
                            </span>
                          )}
                          {/* Тот же признак и та же формулировка, что в
                              CalloutRow.tsx (список активных выездов) — архив
                              не должен молчать о том, что расстановка пришла
                              с планшета уже после закрытия. */}
                          {c.late_sync && (
                            <span className="ml-5 flex items-center gap-1 text-2xs text-info">
                              <LateSyncIcon className="h-3 w-3" aria-hidden />
                              {t("досинхронизировано после закрытия")}
                            </span>
                          )}
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-2.5 sm:table-cell">
                          <StatusChip severity={typeMeta.severity} label={t(typeMeta.label)} />
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-2.5 tabular md:table-cell">
                          {c.rank_declared ?? "—"}
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-2.5 text-right tabular md:table-cell">
                          {formatDuration(c.response_sec)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <StatusChip severity={SEVERITY.info} label={t("Закрыт")} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <LinkButton
                              href={`/callout/report?id=${c.id}`}
                              target="_blank"
                              rel="noreferrer"
                              variant="ghost"
                              size="sm"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              {t("Донесение")}
                            </LinkButton>
                            <LinkButton
                              href={`/callout?id=${c.id}`}
                              target="_blank"
                              rel="noreferrer"
                              variant="ghost"
                              size="sm"
                            >
                              <Package className="h-3.5 w-3.5" />
                              {t("Пакет")}
                            </LinkButton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Пагинация читается из ответа (`data.offset`/`data.limit`), а не
              из фильтра `offset` состояния: пока следующая страница ещё не
              подтверждена успешным ответом, подпись обязана описывать именно
              то, что показано в таблице выше, а не то, что запрошено. */}
          {!loading && !error && data && data.matched > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
              <span className="text-2xs text-faint">
                <span className="tabular">{data.offset + 1}</span>
                {"–"}
                <span className="tabular">{data.offset + data.callouts.length}</span> {t("из")}{" "}
                <span className="tabular">{data.matched.toLocaleString(intlLocale(locale))}</span>
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  disabled={loading || data.offset === 0}
                  aria-label={t("Предыдущая страница")}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                  disabled={loading || data.offset + data.callouts.length >= data.matched}
                  aria-label={t("Следующая страница")}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>

        <p className="mt-3 flex items-center gap-1.5 text-2xs text-faint">
          <CalendarDays className="h-3 w-3" />
          {t(
            "«Донесение» открывает печатную форму по выезду, «Пакет» — боевой пакет в режиме чтения.",
          )}
        </p>
      </div>
    </AppShell>
  );
}
