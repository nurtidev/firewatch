"use client";

/**
 * Боевой выезд — responder tablet (начальник караула / РТП): a read-only
 * боевой пакет with one live action (marking a hydrant). Minimal chrome,
 * big touch targets — this runs in a truck cab or on the fireground, not at
 * a desk. Polls every 15s so it stays current without anyone tapping refresh.
 */
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Siren } from "lucide-react";
import AppShell from "@/components/AppShell";
import CalloutPack from "@/components/CalloutPack";
import CalloutOps from "@/components/CalloutOps";
import CalloutRow from "@/components/CalloutRow";
import { PageHeader, Button, Skeleton, EmptyState, Banner } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useCalloutList, useCalloutPack } from "@/lib/dispatch";

const POLL_MS = 15000;

/** /callout?id=9 keeps the open pack in the URL (same deep-link convention as
 *  /cards?id=). Without this, "Открыть ПТП" navigates to /cards and the
 *  system/browser "back" gesture — a reflex in a truck cab — remounted this
 *  page with the selection gone, dropping the РТП back into the citywide
 *  callout list instead of their pack. useSearchParams requires a Suspense
 *  boundary around the page (Next.js CSR bailout rule) — same as /cards. */
export default function CalloutPage() {
  return (
    <Suspense fallback={null}>
      <CalloutPageInner />
    </Suspense>
  );
}

function CalloutPageInner() {
  const t = useT();
  const router = useRouter();
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id");
  const selectedId = idParam ? Number(idParam) : null;

  const { callouts, error: listError } = useCalloutList("active", POLL_MS);
  const [autoSelected, setAutoSelected] = useState(false);

  const {
    pack,
    loading: packLoading,
    error: packError,
    reload: reloadPack,
  } = useCalloutPack(selectedId, POLL_MS);

  // Отметки боевых действий ставит тот, кто на месте (РТП), либо диспетчер с
  // пульта по докладу. Надзорные роли открывают тот же экран только на чтение.
  const canEdit =
    user?.role === "responder" || user?.role === "dispatcher" || user?.role === "admin";

  const selectCallout = (id: number) => router.replace(`/callout?id=${id}`);
  const backToList = () => router.replace("/callout");

  // Exactly one active callout → open it right away, no extra tap.
  useEffect(() => {
    if (autoSelected || selectedId != null || !callouts) return;
    if (callouts.length === 1) {
      setAutoSelected(true);
      selectCallout(callouts[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callouts, selectedId, autoSelected]);

  const showList = selectedId == null;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1400px] p-5 sm:p-7 lg:p-8">
        {showList ? (
          <>
            <PageHeader
              title={t("Боевой выезд")}
              subtitle={t("Активные выезды — выберите, чтобы открыть боевой пакет")}
            />

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
                title={t("Активных выездов нет")}
                description={t("Как только диспетчер зарегистрирует выезд, он появится здесь.")}
              />
            ) : (
              <div className="mt-5 space-y-3">
                {(callouts ?? []).map((c) => (
                  <CalloutRow key={c.id} callout={c} size="lg" onClick={() => selectCallout(c.id)} />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2">
              <Button size="lg" variant="secondary" onClick={backToList}>
                <ArrowLeft className="h-4 w-4" />
                {t("К списку")}
              </Button>
            </div>

            {packLoading && !pack && (
              <div className="space-y-4">
                <Skeleton className="h-40 w-full" />
                <Skeleton className="h-56 w-full" />
              </div>
            )}
            {packError && !pack && <Banner tone="critical">{packError}</Banner>}
            {pack && (
              <div className="space-y-5">
                <CalloutPack pack={pack} canMarkHydrant large />
                <CalloutOps pack={pack} onChanged={reloadPack} canEdit={canEdit} large />
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
