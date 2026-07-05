"use client";

/**
 * Пульт ЦОУ — dispatcher console: register a callout (fire/smoke/alarm/
 * other), see the боевой пакет immediately, and keep an eye on every active
 * callout in the city. Same pack component as /callout (the responder
 * tablet) so a dispatcher and a начальник караула never read different data.
 */
import { useEffect, useRef, useState } from "react";
import {
  Search,
  LocateFixed,
  Radio,
  Siren,
  Check,
  X,
  RefreshCw,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import CalloutPack from "@/components/CalloutPack";
import CalloutRow from "@/components/CalloutRow";
import { apiFetch } from "@/lib/auth";
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

/** Astana city-centre default — a sane starting point for "точка без здания"
 *  when the dispatcher hasn't typed coordinates yet. */
const DEFAULT_LAT = 51.128;
const DEFAULT_LNG = 71.43;

type ListFilter = "active" | "closed" | "all";

export default function DispatchPage() {
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

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        <PageHeader
          title="Пульт ЦОУ"
          subtitle="Регистрация боевого выезда и боевой пакет караулу"
        />

        <div className="mt-6 grid gap-5 lg:grid-cols-[420px_1fr]">
          {/* Left column: register + list */}
          <div className="space-y-5">
            <RegisterForm onCreated={handleCreated} />

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <SectionLabel>Выезды</SectionLabel>
                <Tabs
                  active={tab}
                  onChange={(id) => setTab(id as ListFilter)}
                  tabs={[
                    { id: "active", label: "Активные" },
                    { id: "closed", label: "Закрытые" },
                    { id: "all", label: "Все" },
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
                  title={tab === "active" ? "Активных выездов нет" : "Выездов нет"}
                  description="Как только выезд будет зарегистрирован, он появится здесь."
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
                title="Выберите выезд"
                description="Зарегистрируйте новый выезд слева или выберите активный из списка, чтобы увидеть боевой пакет."
                className="min-h-[320px]"
              />
            )}
            {!packLoading && !packError && pack && (
              <div className="fw-fade-in space-y-4">
                {pack.callout.status === "active" && (
                  <CloseCalloutBar onClose={(note) => closeCallout(pack.callout.id, note)} />
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

/* ───────────────────────────── Register form ──────────────────────────── */

function RegisterForm({ onCreated }: { onCreated: (pack: CalloutPackData) => void }) {
  const [manual, setManual] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BuildingSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<BuildingSearchResult | null>(null);

  const [lat, setLat] = useState(String(DEFAULT_LAT));
  const [lng, setLng] = useState(String(DEFAULT_LNG));
  const [address, setAddress] = useState("");

  const [calloutType, setCalloutType] = useState<CalloutType>("fire");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Generation counter: a later search can resolve before an earlier one
  // (network reordering) — only the response matching the latest dispatched
  // search is applied, so stale results never clobber fresher ones.
  const searchGenRef = useRef(0);

  // Debounced building search — 300ms, skipped once a building is selected.
  useEffect(() => {
    if (manual || selected || query.trim().length < 2) {
      setResults([]);
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
        })
        .catch(() => {
          if (searchGenRef.current !== gen) return;
          setResults([]);
        })
        .finally(() => {
          if (searchGenRef.current === gen) setSearching(false);
        });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, manual, selected]);

  function reset() {
    setSelected(null);
    setQuery("");
    setResults([]);
    setAddress("");
    setLat(String(DEFAULT_LAT));
    setLng(String(DEFAULT_LNG));
    setNote("");
    setCalloutType("fire");
  }

  function locate() {
    if (!("geolocation" in navigator)) {
      setError("Геолокация не поддерживается на этом устройстве — введите координаты вручную.");
      return;
    }
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
      },
      () => setError("Не удалось получить местоположение — введите координаты вручную."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function submit() {
    setError(null);
    if (!manual && !selected) {
      setError("Выберите здание из списка или переключитесь на «Точка без здания».");
      return;
    }
    let latNum = 0;
    let lngNum = 0;
    if (manual) {
      latNum = Number(lat);
      lngNum = Number(lng);
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
        setError("Координаты должны быть числами.");
        return;
      }
      if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
        setError("Координаты вне допустимого диапазона.");
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
          apiErrorText(d.detail, "Не удалось зарегистрировать выезд") ?? "Не удалось зарегистрировать выезд",
        );
      }
      const created: CalloutPackData = await r.json();
      onCreated(created);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось зарегистрировать выезд");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel>Новый выезд</SectionLabel>
        <label className="flex items-center gap-2 text-xs text-muted">
          Точка без здания
          <button
            type="button"
            role="switch"
            aria-checked={manual}
            onClick={() => {
              setManual((m) => !m);
              setSelected(null);
              setResults([]);
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
        <div className="relative">
          <Field label="Адрес здания">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
                aria-hidden
              />
              <Input
                value={selected ? selected.address : query}
                onChange={(e) => {
                  setSelected(null);
                  setQuery(e.target.value);
                }}
                placeholder="Начните вводить адрес…"
                className="pl-8"
              />
            </div>
          </Field>
          {searching && <p className="mt-1 text-xs text-faint">Поиск…</p>}
          {!selected && results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border-strong bg-surface shadow-pop">
              {results.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setSelected(b);
                    setQuery(b.address);
                    setResults([]);
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-fg">{b.address}</span>
                    {b.district && <span className="text-faint"> · {b.district} р-н</span>}
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
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Адрес (произвольный текст, необязательно)">
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Например: перекрёсток ул. Абая и просп. Республики"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Широта (lat)">
              <Input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" className="tabular" />
            </Field>
            <Field label="Долгота (lng)">
              <Input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" className="tabular" />
            </Field>
          </div>
          <Button size="sm" variant="secondary" type="button" onClick={locate}>
            <LocateFixed className="h-3.5 w-3.5" />
            Моё местоположение
          </Button>
        </div>
      )}

      <div className="mt-4">
        <SectionLabel className="mb-2">Тип вызова</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {CALLOUT_TYPES.map((t) => {
            const meta = CALLOUT_TYPE_META[t];
            const Icon = meta.icon;
            const active = calloutType === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setCalloutType(t)}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-left transition-colors duration-[var(--dur-fast)]",
                  active
                    ? cn(meta.severity.border, meta.severity.bg, meta.severity.text)
                    : "border-border bg-surface-2 text-muted hover:border-border-strong hover:text-fg",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="text-xs font-medium leading-tight">{meta.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <Field label="Заметка (необязательно)">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Детали вызова для караула"
          />
        </Field>
      </div>

      {error && <p className="mt-3 text-xs text-critical">{error}</p>}

      <Button variant="primary" size="xl" className="mt-4 w-full" disabled={submitting} onClick={() => void submit()}>
        {submitting ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Siren className="h-5 w-5" />}
        Зарегистрировать выезд
      </Button>
    </Card>
  );
}

/* ───────────────────────────── Close callout ──────────────────────────── */

function CloseCalloutBar({ onClose }: { onClose: (note: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
          <X className="h-3.5 w-3.5" />
          Закрыть выезд
        </Button>
      </div>
    );
  }

  return (
    <Card className="p-3.5">
      <Field label="Комментарий к закрытию (необязательно)">
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
            if (ok) setOpen(false);
            else setError("Не удалось закрыть выезд — проверьте связь.");
          }}
        >
          {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Подтвердить закрытие
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>
    </Card>
  );
}
