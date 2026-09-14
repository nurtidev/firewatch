"use client";

import { Printer, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n";

/**
 * Screen-only toolbar for a print page (`fw-no-print` — hidden entirely under
 * `@media print`, see globals.css). "Печать / PDF" just calls `window.print()`
 * — the system dialog offers both paper and "Save as PDF", same pattern as
 * app/callout/report/page.tsx's `PrintButton` (that one also POSTs an export
 * audit event first; /city/report has no such event to log, so this stays a
 * plain print call).
 */
export default function PrintToolbar({ onClose }: { onClose?: () => void }) {
  const t = useT();
  return (
    <div className="fw-no-print mx-auto flex max-w-[210mm] items-center justify-between gap-3 p-4">
      <Button
        variant="secondary"
        onClick={onClose ?? (() => window.history.back())}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("Назад")}
      </Button>
      <Button onClick={() => window.print()}>
        <Printer className="h-4 w-4" aria-hidden />
        {t("Печать / PDF")}
      </Button>
    </div>
  );
}
