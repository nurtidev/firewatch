"use client";

/**
 * Боевой выезд — responder tablet (начальник караула / РТП): a read-only
 * боевой пакет with one live action (marking a hydrant). Minimal chrome,
 * big touch targets — this runs in a truck cab or on the fireground, not at
 * a desk. Polls every 15s so it stays current without anyone tapping refresh.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Siren } from "lucide-react";
import AppShell from "@/components/AppShell";
import CalloutPack from "@/components/CalloutPack";
import { apiFetch } from "@/lib/auth";
import { PageHeader, Button, Skeleton, EmptyState, Banner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { CALLOUT_TYPE_META, relativeTimeRu, type Callout, type CalloutPackData } from "@/lib/dispatch";

const POLL_MS = 15000;

export default function CalloutPage() {
  const [callouts, setCallouts] = useState<Callout[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [autoSelected, setAutoSelected] = useState(false);

  const [pack, setPack] = useState<CalloutPackData | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [packLoading, setPackLoading] = useState(false);

  const loadList = useCallback(() => {
    apiFetch(`/dispatch?status=active`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("list"))))
      .then((d: Callout[]) => {
        setCallouts(d);
        setListError(null);
      })
      .catch(() => setListError("Не удалось загрузить выезды. Проверьте связь."));
  }, []);

  useEffect(() => {
    loadList();
    const t = setInterval(loadList, POLL_MS);
    return () => clearInterval(t);
  }, [loadList]);

  // Exactly one active callout → open it right away, no extra tap.
  useEffect(() => {
    if (autoSelected || selectedId != null || !callouts) return;
    if (callouts.length === 1) {
      setAutoSelected(true);
      setSelectedId(callouts[0].id);
    }
  }, [callouts, selectedId, autoSelected]);

  const loadPack = useCallback((id: number) => {
    setPackLoading(true);
    apiFetch(`/dispatch/${id}/pack`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("pack"))))
      .then((d: CalloutPackData) => {
        setPack(d);
        setPackError(null);
      })
      .catch(() => setPackError("Не удалось загрузить боевой пакет."))
      .finally(() => setPackLoading(false));
  }, []);

  // Keep the open pack current (hydrant marks from another device, closure by ЦОУ).
  useEffect(() => {
    if (selectedId == null) return;
    loadPack(selectedId);
    const t = setInterval(() => loadPack(selectedId), POLL_MS);
    return () => clearInterval(t);
  }, [selectedId, loadPack]);

  const showList = selectedId == null;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
        {showList ? (
          <>
            <PageHeader title="Боевой выезд" subtitle="Активные выезды — выберите, чтобы открыть боевой пакет" />

            {listError && (
              <Banner tone="critical" className="mt-4">
                {listError}
              </Banner>
            )}

            {callouts === null && !listError ? (
              <div className="mt-5 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : callouts && callouts.length === 0 ? (
              <EmptyState
                className="mt-8"
                icon={Siren}
                title="Активных выездов нет"
                description="Как только диспетчер зарегистрирует выезд, он появится здесь."
              />
            ) : (
              <div className="mt-5 space-y-3">
                {(callouts ?? []).map((c) => (
                  <CalloutBigRow key={c.id} callout={c} onClick={() => setSelectedId(c.id)} />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2">
              <Button
                size="lg"
                variant="secondary"
                onClick={() => {
                  setSelectedId(null);
                  setPack(null);
                  setPackError(null);
                }}
              >
                <ArrowLeft className="h-4 w-4" />К списку
              </Button>
            </div>

            {packLoading && !pack && (
              <div className="space-y-4">
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-56 w-full" />
              </div>
            )}
            {packError && !pack && <Banner tone="critical">{packError}</Banner>}
            {pack && <CalloutPack pack={pack} canMarkHydrant large />}
          </>
        )}
      </div>
    </AppShell>
  );
}

/* ───────────────────────────── Big list row ────────────────────────────── */

function CalloutBigRow({ callout, onClick }: { callout: Callout; onClick: () => void }) {
  const meta = CALLOUT_TYPE_META[callout.callout_type];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-4 rounded-xl border-2 border-border bg-surface p-4 text-left transition-colors duration-[var(--dur-fast)] hover:border-border-strong hover:bg-surface-2 sm:p-5",
      )}
    >
      <span
        className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-xl", meta.severity.bg)}
        aria-hidden
      >
        <Icon className={cn("h-7 w-7", meta.severity.text)} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-semibold text-fg sm:text-xl">
          {callout.address || `${callout.lat.toFixed(4)}, ${callout.lng.toFixed(4)}`}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <span className={cn("font-medium", meta.severity.text)}>{meta.label}</span>
          <span className="tabular">· {relativeTimeRu(callout.created_at)}</span>
          {callout.station && <span className="truncate">· {callout.station.name}</span>}
        </p>
      </div>
    </button>
  );
}
