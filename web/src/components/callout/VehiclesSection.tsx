"use client";

/** Наряд сил: назначенная на выезд техника против расчёта по методике. */
import { useState } from "react";
import { Loader2, Plus, Truck, X } from "lucide-react";
import { Badge, Button, Card, SectionLabel, StatusChip } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { SEVERITY } from "@/lib/risk";
import {
  VEHICLE_TYPE_META,
  assignVehicles,
  releaseVehicle,
  useVehicles,
  type CalloutPackData,
} from "@/lib/dispatch";
import type { RunAction } from "./types";

export default function VehiclesSection({
  pack,
  editable,
  large,
  busy,
  onRun,
}: {
  pack: CalloutPackData;
  editable: boolean;
  large?: boolean;
  busy: string | null;
  onRun: RunAction;
}) {
  const t = useT();
  const [picking, setPicking] = useState(false);
  // Справочник по всему городу тянется только когда РТП открыл выбор техники.
  const { data, reload } = useVehicles(null, picking ? 15000 : undefined, picking);

  const assigned = pack.vehicles;
  const assignedIds = new Set(assigned.map((v) => v.id));
  // В строю и не в этом наряде — то, что реально можно отправить сейчас.
  const available = (data?.vehicles ?? []).filter(
    (v) => v.status === "in_service" && !assignedIds.has(v.id),
  );

  const hint = pack.forces_hint;
  // Расчёт предлагает N машин — сравнение с фактом здесь и есть смысл наряда.
  const needed = hint?.trucks ?? null;
  const short = needed != null && assigned.length < needed;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>
          <Truck className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
          {t("Наряд сил")}
        </SectionLabel>
        <div className="flex items-center gap-2">
          {needed != null && (
            <StatusChip
              severity={short ? SEVERITY.high : SEVERITY.normal}
              label={`${assigned.length} / ${needed} ${t("по расчёту")}`}
            />
          )}
          {editable && (
            <Button
              size={large ? "lg" : "sm"}
              variant="secondary"
              onClick={() => {
                setPicking((v) => !v);
                reload();
              }}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t("Назначить")}
            </Button>
          )}
        </div>
      </div>

      {assigned.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("Техника на выезд не назначена.")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {assigned.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Badge>{t(VEHICLE_TYPE_META[v.vehicle_type].short)}</Badge>
                <span className="truncate text-sm font-medium text-fg">{v.callsign}</span>
                <span className="truncate text-xs text-faint">{v.station_name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {v.water_l != null && (
                  <span className="tabular text-xs text-muted">{v.water_l} {t("л")}</span>
                )}
                {editable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onRun(`rel-${v.id}`, () => releaseVehicle(pack.callout.id, v.id))}
                    disabled={busy === `rel-${v.id}`}
                    aria-label={`${t("Снять с выезда")}: ${v.callsign}`}
                  >
                    {busy === `rel-${v.id}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <X className="h-4 w-4" aria-hidden />
                    )}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {picking && editable && (
        <div className="mt-3 border-t border-border pt-3">
          <SectionLabel>{t("Свободная техника")}</SectionLabel>
          {available.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              {t("Свободной техники в строю нет — проверьте состояние машин в частях.")}
            </p>
          ) : (
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {available.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onRun(`asg-${v.id}`, () => assignVehicles(pack.callout.id, [v.id])).then(reload)
                    }
                    disabled={busy === `asg-${v.id}`}
                    className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left transition-[background-color] duration-[var(--dur-fast)] hover:bg-surface-2 disabled:opacity-50"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge>{t(VEHICLE_TYPE_META[v.vehicle_type].short)}</Badge>
                      <span className="truncate text-sm text-fg">{v.callsign}</span>
                    </span>
                    <span className="truncate text-xs text-faint">{v.station_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
