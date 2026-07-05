/**
 * Owner portal ("Мой объект") — external building-owner / ОСИ-chair view.
 * Types mirror the fixed /portal/* API contract. Also home to the
 * prescription-severity mapping and remediation status meta shared with
 * /cards (same object rendered on both surfaces must read the same way —
 * same rule as lib/risk.ts for building risk).
 */
import type { LucideIcon } from "lucide-react";
import { Clock, ShieldCheck, Ban } from "lucide-react";
import { SEVERITY, type SeverityMeta } from "./risk";

/** Prescription severity is a free-form string from the extraction model
 *  ("high" | "medium" | anything else), not a 0–100 score — map it onto the
 *  same SEVERITY palette used everywhere else. Single source for /cards and
 *  the owner portal. */
export function prescriptionSeverity(s: string | null): SeverityMeta {
  if (s === "high") return SEVERITY.critical;
  if (s === "medium") return SEVERITY.high;
  return SEVERITY.elevated;
}

export type RemediationStatus = "pending" | "accepted" | "declined";

/** Remediation status → label/icon, for both the owner portal and the
 *  /cards review UI. */
export const REMEDIATION_STATUS: Record<
  RemediationStatus,
  { label: string; icon: LucideIcon; cls: string }
> = {
  pending: {
    label: "На проверке ДЧС",
    icon: Clock,
    cls: "border-elevated/40 bg-elevated-bg text-elevated",
  },
  accepted: {
    label: "Устранено, подтверждено",
    icon: ShieldCheck,
    cls: "border-normal/40 bg-normal-bg text-normal",
  },
  declined: {
    label: "Отклонено",
    icon: Ban,
    cls: "border-critical/40 bg-critical-bg text-critical",
  },
};

export type PortalBuilding = {
  id: number;
  address: string;
  district: string | null;
  building_type: string | null;
  floors: number | null;
  risk_score: number | null;
};

export type PortalSummary = {
  buildings: PortalBuilding[];
  counts: {
    prescriptions_active: number;
    remediations_pending: number;
  };
};

export type Remediation = {
  id: number;
  note: string;
  photos: string[];
  status: RemediationStatus;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

export type PortalPrescription = {
  id: number;
  card_id: number;
  building_id: number;
  address: string;
  issue: string | null;
  recommendation: string;
  deadline_days: number | null;
  severity: string | null;
  created_at: string;
  due_date: string | null;
  overdue: boolean;
  remediation: Remediation | null;
};
