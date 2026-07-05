"use client";

/**
 * Боевой выезд — responder tablet (начальник караула / РТП): a read-only
 * боевой пакет with one live action (marking a hydrant). Minimal chrome,
 * big touch targets — this runs in a truck cab or on the fireground, not at
 * a desk. Polls every 15s so it stays current without anyone tapping refresh.
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Siren } from "lucide-react";
import AppShell from "@/components/AppShell";
import CalloutPack from "@/components/CalloutPack";
import CalloutRow from "@/components/CalloutRow";
import { PageHeader, Button, Skeleton, EmptyState, Banner } from "@/components/ui";
import { useCalloutList, useCalloutPack } from "@/lib/dispatch";

const POLL_MS = 15000;

export default function CalloutPage() {
  const { callouts, error: listError } = useCalloutList("active", POLL_MS);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [autoSelected, setAutoSelected] = useState(false);

  const { pack, loading: packLoading, error: packError } = useCalloutPack(selectedId, POLL_MS);

  // Exactly one active callout → open it right away, no extra tap.
  useEffect(() => {
    if (autoSelected || selectedId != null || !callouts) return;
    if (callouts.length === 1) {
      setAutoSelected(true);
      setSelectedId(callouts[0].id);
    }
  }, [callouts, selectedId, autoSelected]);

  const showList = selectedId == null;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
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
                  <CalloutRow key={c.id} callout={c} size="lg" onClick={() => setSelectedId(c.id)} />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2">
              <Button size="lg" variant="secondary" onClick={() => setSelectedId(null)}>
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
