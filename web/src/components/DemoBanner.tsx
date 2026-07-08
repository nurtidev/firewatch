"use client";

import { FlaskConical } from "lucide-react";
import { Banner } from "@/components/ui";
import { DEMO_DATA, DEMO_NOTICE } from "@/lib/demo";
import { useT } from "@/lib/i18n";

/**
 * Renders the synthetic-data warning when DEMO_DATA is on, nothing otherwise.
 * Drop it at the top of any screen that surfaces risk scores or model metrics.
 */
export default function DemoBanner({ className }: { className?: string }) {
  const t = useT();
  if (!DEMO_DATA) return null;
  return (
    <Banner
      tone="warning"
      icon={FlaskConical}
      title={t("Демонстрационные данные")}
      className={className}
    >
      {t(DEMO_NOTICE)}
    </Banner>
  );
}
