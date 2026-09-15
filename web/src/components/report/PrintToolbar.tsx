"use client";

import { useState } from "react";
import { Printer, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n";

/**
 * Screen-only toolbar for a print page (`fw-no-print` — hidden entirely under
 * `@media print`, see globals.css). "Печать / PDF" calls `window.print()` —
 * the system dialog offers both paper and "Save as PDF".
 *
 * `onBeforePrint` runs first (with a spinner) — /callout/report logs the
 * export to the audit journal there. Its failure never blocks printing: the
 * connection may be gone, and the report is needed now. /city/report has no
 * such event to log and prints straight away.
 */
export default function PrintToolbar({
  onClose,
  closeLabel,
  onBeforePrint,
  printDisabled = false,
}: {
  onClose?: () => void;
  /** Defaults to «Назад»; a report opened in its own tab says «Закрыть». */
  closeLabel?: string;
  onBeforePrint?: () => Promise<unknown>;
  printDisabled?: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  const print = async () => {
    if (onBeforePrint) {
      setBusy(true);
      try {
        await onBeforePrint();
      } catch {
        // См. выше: журнал не должен мешать печати.
      } finally {
        setBusy(false);
      }
    }
    window.print();
  };

  return (
    <div className="fw-no-print mx-auto flex max-w-[210mm] items-center justify-between gap-3 p-4">
      <Button
        variant="secondary"
        onClick={onClose ?? (() => window.history.back())}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {closeLabel ?? t("Назад")}
      </Button>
      <Button onClick={() => void print()} disabled={printDisabled || busy}>
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Printer className="h-4 w-4" aria-hidden />
        )}
        {t("Печать / PDF")}
      </Button>
    </div>
  );
}
