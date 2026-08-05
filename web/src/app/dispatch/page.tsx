"use client";

/**
 * Пульт ЦОУ — dispatcher console: register a callout (fire/smoke/alarm/
 * other), see the боевой пакет immediately, and keep an eye on every active
 * callout in the city. Same pack component as /callout (the responder
 * tablet) so a dispatcher and a начальник караула never read different data.
 */
import { useEffect, useId, useRef, useState } from "react";
import {
  Search,
  SearchX,
  LocateFixed,
  MapPinOff,
  Radio,
  Siren,
  Check,
  X,
  Repeat2,
  RefreshCw,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import CalloutPack from "@/components/CalloutPack";
import CalloutRow from "@/components/CalloutRow";
import { apiFetch } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { apiErrorText } from "@/lib/api-error";
import { scoreSeverity } from "@/lib/risk";
import {
  PageHeader,
  Card,
  SectionLabel,
  Button,
  Field,
  Input,
  Textarea,
  ScoreBadge,
  Skeleton,
  EmptyState,
  Banner,
  Tabs,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  CALLOUT_TYPES,
  CALLOUT_TYPE_META,
  useCalloutList,
  useCalloutPack,
  type CalloutType,
  type CalloutPackData,
  type BuildingSearchResult,
} from "@/lib/dispatch";

/** Ориентиры Астаны — только как placeholder в пустых полях координат.
 *  Реальными значениями поля НЕ предзаполняются: «точка без здания» — это путь,
 *  на который диспетчер уходит после неудачного поиска, под давлением. Забытые
 *  координаты центра города выглядели бы на экране как учтённый адрес, а караул
 *  уехал бы в центр. Пусто — значит видно, что не заполнено. */
const LAT_PLACEHOLDER = "51.128";
const LNG_PLACEHOLDER = "71.430";

type ListFilter = "active" | "closed" | "all";

export default function DispatchPage() {
  const t = useT();
  const [tab, setTab] = useState<ListFilter>("active");
  const { callouts, error: listError, reload: loadList } = useCalloutList(tab, 30000);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { pack, loading: packLoading, error: packError, reload: reloadPack, setPack } =
    useCalloutPack(selectedId);

  function handleCreated(created: CalloutPackData) {
    setPack(created);
    setSelectedId(created.callout.id);
    loadList();
  }

  async function closeCallout(id: number, closeNote: string) {
    const r = await apiFetch(`/dispatch/${id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ close_note: closeNote.trim() || undefined }),
    });
    if (r.ok) {
      loadList();
      reloadPack();
    }
    return r.ok;
  }

  /** Промах мимо строки в списке исправляется на месте: объект и часть выезда
   *  меняются без закрытия — иначе неверная часть числится выехавшей. */
  async function reassign(id: number, buildingId: number) {
    const r = await apiFetch(`/dispatch/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ building_id: buildingId }),
    });
    if (!r.ok) return false;
    setPack(await r.json());
    loadList();
    return true;
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title={t("Пульт ЦОУ")}
          subtitle={t("Регистрация боевого выезда и боевой пакет караулу")}
        />

        <div className="mt-6 grid gap-5 lg:grid-cols-[420px_1fr]">
          {/* Left column: register + list */}
          <div className="space-y-5">
            <RegisterForm onCreated={handleCreated} />

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <SectionLabel>{t("Выезды")}</SectionLabel>
                <Tabs
                  active={tab}
                  onChange={(id) => setTab(id as ListFilter)}
                  tabs={[
                    { id: "active", label: t("Активные") },
                    { id: "closed", label: t("Закрытые") },
                    { id: "all", label: t("Все") },
                  ]}
                />
              </div>

              {listError && (
                <Banner tone="critical" className="mb-2">
                  {listError}
                </Banner>
              )}

              {callouts === null && !listError ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : callouts && callouts.length === 0 ? (
                <EmptyState
                  icon={Radio}
                  title={tab === "active" ? t("Активных выездов нет") : t("Выездов нет")}
                  description={t("Как только выезд будет зарегистрирован, он появится здесь.")}
                />
              ) : (
                <div className="space-y-2">
                  {(callouts ?? []).map((c) => (
                    <CalloutRow
                      key={c.id}
                      callout={c}
                      size="sm"
                      active={selectedId === c.id}
                      onClick={() => setSelectedId(c.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right column: боевой пакет */}
          <div>
            {packLoading && (
              <div className="space-y-4">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-48 w-full" />
              </div>
            )}
            {!packLoading && packError && <Banner tone="critical">{packError}</Banner>}
            {!packLoading && !packError && !pack && (
              <EmptyState
                icon={Radio}
                title={t("Выберите выезд")}
                description={t(
                  "Зарегистрируйте новый выезд слева или выберите активный из списка, чтобы увидеть боевой пакет.",
                )}
                className="min-h-[320px]"
              />
            )}
            {!packLoading && !packError && pack && (
              <div className="fw-fade-in space-y-4">
                {pack.callout.status === "active" && (
                  <CalloutActions
                    key={pack.callout.id}
                    onReassign={(buildingId) => reassign(pack.callout.id, buildingId)}
                    onClose={(note) => closeCallout(pack.callout.id, note)}
                  />
                )}
                <CalloutPack pack={pack} canMarkHydrant />
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/* ───────────────────────────── Building search ────────────────────────── */

/**
 * Поиск объекта по адресу — общий для регистрации выезда и переназначения
 * ошибочно выбранного объекта.
 *
 * Клавиатурный путь (скорость диспетчера, а не accessibility) держится на
 * порядке DOM: поле ввода → кнопки результатов сразу за ним. Tab из поля
 * попадает на первый результат, Enter выбирает. Подсказка «ничего не найдено»
 * рендерится после списка и появляется только когда список пуст, поэтому в
 * табуляцию между полем и результатами она не вклинивается.
 */
function BuildingSearch({
  selected,
  onSelect,
  label,
  emptyAction,
}: {
  selected: BuildingSearchResult | null;
  onSelect: (b: BuildingSearchResult | null) => void;
  label: string;
  /** Что предложить, когда ничего не нашлось (получает набранный текст). */
  emptyAction?: (query: string) => React.ReactNode;
}) {
  const t = useT();
  // Форма поиска живёт в двух местах сразу (регистрация и переназначение) —
  // id статуса обязан быть свой у каждой, иначе aria-describedby указывает
  // на чужой элемент.
  const statusId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BuildingSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  // «Ответ пришёл, результатов ноль» — отдельное состояние: до этой отметки
  // пустой экран означает «ещё не искали», а не «адреса нет».
  const [answered, setAnswered] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Generation counter: a later search can resolve before an earlier one
  // (network reordering) — only the response matching the latest dispatched
  // search is applied, so stale results never clobber fresher ones.
  const searchGenRef = useRef(0);

  // Debounced building search — 300ms, skipped once a building is selected.
  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setResults([]);
      setAnswered(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const gen = ++searchGenRef.current;
      setSearching(true);
      apiFetch(`/dispatch/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((d: BuildingSearchResult[]) => {
          if (searchGenRef.current !== gen) return;
          setResults(d);
          setAnswered(true);
        })
        .catch(() => {
          if (searchGenRef.current !== gen) return;
          setResults([]);
          setAnswered(true);
        })
        .finally(() => {
          if (searchGenRef.current === gen) setSearching(false);
        });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, selected]);

  const nothingFound = !selected && !searching && answered && results.length === 0;

  return (
    <div className="relative">
      <Field label={label}>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
            aria-hidden
          />
          <Input
            value={selected ? selected.address : query}
            onChange={(e) => {
              onSelect(null);
              setQuery(e.target.value);
            }}
            placeholder={t("Начните вводить адрес…")}
            className="pl-8"
            aria-describedby={statusId}
          />
        </div>
      </Field>
      {searching && <p className="mt-1 text-xs text-faint">{t("Поиск…")}</p>}
      {!selected && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border-strong bg-surface shadow-pop">
          {results.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                onSelect(b);
                setQuery(b.address);
                setResults([]);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              <span className="min-w-0 truncate">
                <span className="text-fg">{b.address}</span>
                {b.district && <span className="text-faint"> · {b.district} {t("р-н")}</span>}
                {/* Нашлось по народному названию — видно, почему эта строка */}
                {b.alias && (
                  <span className="block truncate text-xs text-faint">{b.alias}</span>
                )}
              </span>
              {b.risk_score != null && (
                <ScoreBadge
                  score={b.risk_score}
                  severity={scoreSeverity(b.risk_score)}
                  className="shrink-0"
                />
              )}
            </button>
          ))}
        </div>
      )}
      <p id={statusId} className="sr-only" role="status">
        {searching
          ? t("Поиск…")
          : nothingFound
            ? t("Ничего не найдено")
            : results.length > 0
              ? `${results.length}`
              : ""}
      </p>
      {nothingFound && (
        <div className="mt-2 rounded-lg border border-dashed border-border bg-surface/40 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-fg">
            <SearchX className="h-4 w-4 shrink-0 text-faint" aria-hidden />
            {t("Ничего не найдено")}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t(
              "Проверьте номер дома или наберите улицу иначе — можно русскими буквами, без казахских (тауелсиздик 33). Ищется и по названию комплекса.",
            )}
          </p>
          {emptyAction && <div className="mt-2.5">{emptyAction(query.trim())}</div>}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── Register form ──────────────────────────── */

function RegisterForm({ onCreated }: { onCreated: (pack: CalloutPackData) => void }) {
  const t = useT();
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<BuildingSearchResult | null>(null);
  // Ключ ремонтирует поисковое поле после успешной регистрации: своё состояние
  // (набранный текст, выдача) сбрасывается вместе с формой.
  const [formKey, setFormKey] = useState(0);

  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [address, setAddress] = useState("");

  const [calloutType, setCalloutType] = useState<CalloutType>("fire");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSelected(null);
    setAddress("");
    setLat("");
    setLng("");
    setNote("");
    setCalloutType("fire");
    setFormKey((k) => k + 1);
  }

  function locate() {
    if (!("geolocation" in navigator)) {
      setError(t("Геолокация не поддерживается на этом устройстве — введите координаты вручную."));
      return;
    }
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
      },
      () => setError(t("Не удалось получить местоположение — введите координаты вручную.")),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submit() {
    setError(null);
    if (!manual && !selected) {
      setError(t("Выберите здание из списка или переключитесь на «Точка без здания»."));
      return;
    }
    let latNum = 0;
    let lngNum = 0;
    if (manual) {
      if (!lat.trim() || !lng.trim()) {
        setError(t("Укажите координаты точки — по ним поедет караул."));
        return;
      }
      latNum = Number(lat);
      lngNum = Number(lng);
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
        setError(t("Координаты должны быть числами."));
        return;
      }
      if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
        setError(t("Координаты вне допустимого диапазона."));
        return;
      }
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        callout_type: calloutType,
        note: note.trim() || undefined,
      };
      if (manual) {
        body.lat = latNum;
        body.lng = lngNum;
        if (address.trim()) body.address = address.trim();
      } else if (selected) {
        body.building_id = selected.id;
      }
      const r = await apiFetch(`/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(
          apiErrorText(d.detail, t("Не удалось зарегистрировать выезд")) ??
            t("Не удалось зарегистрировать выезд"),
        );
      }
      const created: CalloutPackData = await r.json();
      onCreated(created);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Не удалось зарегистрировать выезд"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel>{t("Новый выезд")}</SectionLabel>
        <label className="flex items-center gap-2 text-xs text-muted">
          {t("Точка без здания")}
          <button
            type="button"
            role="switch"
            aria-checked={manual}
            onClick={() => {
              setManual((m) => !m);
              setSelected(null);
              setError(null);
            }}
            className={cn(
              "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--dur-fast)]",
              manual ? "bg-accent" : "bg-surface-3",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-4 w-4 rounded-full bg-fg transition-transform duration-[var(--dur-fast)]",
                manual ? "translate-x-4" : "translate-x-0.5",
              )}
            />
          </button>
        </label>
      </div>

      {!manual ? (
        <BuildingSearch
          key={formKey}
          selected={selected}
          onSelect={setSelected}
          label={t("Адрес здания")}
          emptyAction={(q) => (
            <Button
              size="sm"
              variant="secondary"
              type="button"
              onClick={() => {
                setManual(true);
                setSelected(null);
                setError(null);
                if (q) setAddress(q);
              }}
            >
              <MapPinOff className="h-3.5 w-3.5" />
              {t("Зарегистрировать как точку без здания")}
            </Button>
          )}
        />
      ) : (
        <div className="space-y-3">
          <Field label={t("Адрес (произвольный текст, необязательно)")}>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t("Например: перекрёсток ул. Абая и просп. Республики")}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={t("Широта (lat)")}>
              <Input
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                inputMode="decimal"
                className="tabular"
                placeholder={LAT_PLACEHOLDER}
                required
              />
            </Field>
            <Field label={t("Долгота (lng)")}>
              <Input
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                inputMode="decimal"
                className="tabular"
                placeholder={LNG_PLACEHOLDER}
                required
              />
            </Field>
          </div>
          {/* Пустые координаты — не мелочь: по ним считается ближайшая часть */}
          {(!lat.trim() || !lng.trim()) && (
            <Banner tone="warning">
              {t("Координаты не заданы — выезд не зарегистрируется, пока их нет. Текстовый адрес выше не определяет точку на карте.")}
            </Banner>
          )}
          <Button size="sm" variant="secondary" type="button" onClick={locate}>
            <LocateFixed className="h-3.5 w-3.5" />
            {t("Моё местоположение")}
          </Button>
        </div>
      )}

      <div className="mt-4">
        <SectionLabel className="mb-2">{t("Тип вызова")}</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {CALLOUT_TYPES.map((ct) => {
            const meta = CALLOUT_TYPE_META[ct];
            const Icon = meta.icon;
            const active = calloutType === ct;
            return (
              <button
                key={ct}
                type="button"
                onClick={() => setCalloutType(ct)}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-left transition-colors duration-[var(--dur-fast)]",
                  active
                    ? cn(meta.severity.border, meta.severity.bg, meta.severity.text)
                    : "border-border bg-surface-2 text-muted hover:border-border-strong hover:text-fg",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="text-xs font-medium leading-tight">{t(meta.label)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <Field label={t("Заметка (необязательно)")}>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={t("Детали вызова для караула")}
          />
        </Field>
      </div>

      {error && <p className="mt-3 text-xs text-critical">{error}</p>}

      <Button variant="primary" size="xl" className="mt-4 w-full" disabled={submitting} onClick={() => void submit()}>
        {submitting ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Siren className="h-5 w-5" />}
        {t("Зарегистрировать выезд")}
      </Button>
    </Card>
  );
}

/* ───────────────────────────── Callout actions ────────────────────────── */

/**
 * Действия по действующему выезду: переназначить объект и закрыть.
 * «Переназначить» появилось потому, что промах мимо строки в выпадающем списке
 * при быстром вводе стоил полного повторного прохода: закрыть выезд, набрать
 * адрес заново, выбрать тип — и всё это время ошибочно назначенная часть
 * числилась выехавшей не туда.
 */
function CalloutActions({
  onReassign,
  onClose,
}: {
  onReassign: (buildingId: number) => Promise<boolean>;
  onClose: (note: string) => Promise<boolean>;
}) {
  const t = useT();
  const [mode, setMode] = useState<"idle" | "reassign" | "close">("idle");

  if (mode === "reassign") {
    return <ReassignBar onReassign={onReassign} onCancel={() => setMode("idle")} />;
  }
  if (mode === "close") {
    return <CloseCalloutBar onClose={onClose} onCancel={() => setMode("idle")} />;
  }
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button size="sm" variant="secondary" onClick={() => setMode("reassign")}>
        <Repeat2 className="h-3.5 w-3.5" />
        {t("Переназначить объект")}
      </Button>
      <Button size="sm" variant="danger" onClick={() => setMode("close")}>
        <X className="h-3.5 w-3.5" />
        {t("Закрыть выезд")}
      </Button>
    </div>
  );
}

function ReassignBar({
  onReassign,
  onCancel,
}: {
  onReassign: (buildingId: number) => Promise<boolean>;
  onCancel: () => void;
}) {
  const t = useT();
  const [selected, setSelected] = useState<BuildingSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="p-3.5">
      <BuildingSearch
        selected={selected}
        onSelect={setSelected}
        label={t("Новый объект выезда")}
      />
      <p className="mt-2 text-xs text-muted">
        {t("Адрес, точка и ближайшая часть пересчитаются по выбранному объекту. Выезд останется открытым.")}
      </p>
      {error && <p className="mt-2 text-xs text-critical">{error}</p>}
      <div className="mt-2.5 flex items-center gap-2">
        <Button
          size="sm"
          disabled={busy || !selected}
          onClick={async () => {
            if (!selected) return;
            setBusy(true);
            setError(null);
            const ok = await onReassign(selected.id);
            setBusy(false);
            if (ok) onCancel();
            else setError(t("Не удалось переназначить выезд — проверьте связь."));
          }}
        >
          {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {t("Переназначить")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("Отмена")}
        </Button>
      </div>
    </Card>
  );
}

function CloseCalloutBar({
  onClose,
  onCancel,
}: {
  onClose: (note: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const t = useT();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card className="p-3.5">
      <Field label={t("Комментарий к закрытию (необязательно)")}>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </Field>
      {error && <p className="mt-2 text-xs text-critical">{error}</p>}
      <div className="mt-2.5 flex items-center gap-2">
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const ok = await onClose(note);
            setBusy(false);
            if (ok) onCancel();
            else setError(t("Не удалось закрыть выезд — проверьте связь."));
          }}
        >
          {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {t("Подтвердить закрытие")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("Отмена")}
        </Button>
      </div>
    </Card>
  );
}
