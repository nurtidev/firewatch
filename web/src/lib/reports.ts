/**
 * Field reports ("полевые донесения") — obstacles to firefighting spotted
 * outside a planned inspection (blocked access, broken hydrant, blocked
 * exit, …). Single source for category/status labels, icons and severity so
 * the reports list, the map layer and any future surface stay in sync —
 * same rule as lib/risk.ts for building risk.
 */
import type { LucideIcon } from "lucide-react";
import { Car, TrafficCone, Droplets, DoorClosed, FileWarning, CircleHelp } from "lucide-react";
import { SEVERITY, type SeverityMeta } from "./risk";

export type ReportCategory =
  | "blocked_access"
  | "parking_barrier"
  | "hydrant_defect"
  | "blocked_exit"
  | "ptp_mismatch"
  | "other";

export type ReportStatus = "open" | "in_progress" | "resolved" | "dismissed";

export type Report = {
  id: number;
  category: ReportCategory;
  description: string | null;
  status: ReportStatus;
  lat: number;
  lng: number;
  building_id: number | null;
  address: string | null;
  district: string | null;
  photos: string[];
  created_by: string;
  created_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
};

export const REPORT_CATEGORIES: ReportCategory[] = [
  "blocked_access",
  "blocked_exit",
  "hydrant_defect",
  "parking_barrier",
  "ptp_mismatch",
  "other",
];

export const REPORT_STATUSES: ReportStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "dismissed",
];

/**
 * Category → label / icon / severity / evidence rule. Severity here means "how
 * badly this obstructs firefighting", not building risk: a blocked access road
 * or a blocked evacuation exit reads as critical, a broken hydrant as high, an
 * anti-parking bollard as elevated, everything else as informational.
 *
 * `photoRequired` marks the obstacle categories where the photo IS the
 * evidence — a car in the fire lane is gone by tomorrow, so an unphotographed
 * claim is unenforceable. The two non-obstacle categories are filed after the
 * fact (a crew back from a callout recording "floor 14 doesn't match the ПТП"
 * has nothing left to photograph), so they take a written description instead —
 * mirrored by PHOTO_REQUIRED_CATEGORIES in api/app/routers/reports.py.
 */
export const CATEGORY_META: Record<
  ReportCategory,
  { label: string; icon: LucideIcon; severity: SeverityMeta; photoRequired: boolean }
> = {
  blocked_access: {
    label: "Проезд заблокирован авто",
    icon: Car,
    severity: SEVERITY.critical,
    photoRequired: true,
  },
  blocked_exit: {
    label: "Эвакуационный выход заблокирован",
    icon: DoorClosed,
    severity: SEVERITY.critical,
    photoRequired: true,
  },
  hydrant_defect: {
    label: "Гидрант неисправен",
    icon: Droplets,
    severity: SEVERITY.high,
    photoRequired: true,
  },
  parking_barrier: {
    label: "Антипарковочные конструкции",
    icon: TrafficCone,
    severity: SEVERITY.elevated,
    photoRequired: true,
  },
  ptp_mismatch: {
    label: "Расхождение с ПТП",
    icon: FileWarning,
    severity: SEVERITY.high,
    photoRequired: false,
  },
  other: { label: "Другое", icon: CircleHelp, severity: SEVERITY.info, photoRequired: false },
};

/**
 * Status → label / severity. Ordered by urgency: an untouched report is the
 * most urgent (high), one being worked is elevated, resolved is normal
 * (good outcome), dismissed is informational (closed, no action needed).
 */
export const STATUS_META: Record<ReportStatus, { label: string; severity: SeverityMeta }> = {
  open: { label: "Открыто", severity: SEVERITY.high },
  in_progress: { label: "В работе", severity: SEVERITY.elevated },
  resolved: { label: "Решено", severity: SEVERITY.normal },
  dismissed: { label: "Отклонено", severity: SEVERITY.info },
};

/**
 * Literal hex mirrors of the SEVERITY tokens (lib/risk.ts), for MapLibre paint
 * expressions — WebGL color parsing can't resolve CSS custom properties, so
 * map layers hardcode the same values as `--critical/--high/--elevated/--info`
 * in globals.css (same convention as RiskMap.tsx / InfraMap.tsx). Keep these
 * in sync if the design tokens change.
 */
export const CATEGORY_MAP_COLOR: Record<ReportCategory, string> = {
  blocked_access: "#ff453a", // critical
  blocked_exit: "#ff453a", // critical
  hydrant_defect: "#ff8c1a", // high
  ptp_mismatch: "#ff8c1a", // high
  parking_barrier: "#ffd029", // elevated
  other: "#3d9bff", // info
};
