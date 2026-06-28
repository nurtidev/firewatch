"use client";

import { FlaskConical } from "lucide-react";
import { Banner } from "@/components/ui";
import { DEMO_DATA, DEMO_NOTICE } from "@/lib/demo";

/**
 * Renders the synthetic-data warning when DEMO_DATA is on, nothing otherwise.
 * Drop it at the top of any screen that surfaces risk scores or model metrics.
 */
export default function DemoBanner({ className }: { className?: string }) {
  if (!DEMO_DATA) return null;
  return (
    <Banner
      tone="warning"
      icon={FlaskConical}
      title="Демонстрационные данные"
      className={className}
    >
      {DEMO_NOTICE}
    </Banner>
  );
}
