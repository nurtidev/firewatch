"use client";

/** Расход средств — документальное действие: уточняется и после закрытия. */
import { useState } from "react";
import { Loader2, Package } from "lucide-react";
import { Button, Card, EmptyState, Input, SectionLabel } from "@/components/ui";
import { useT } from "@/lib/i18n";
import {
  RESOURCE_ITEMS,
  RESOURCE_META,
  putResources,
  type CalloutPackData,
} from "@/lib/dispatch";
import type { RunAction } from "./types";

export default function ResourcesSection({
  pack,
  editable,
  busy,
  onRun,
}: {
  pack: CalloutPackData;
  editable: boolean;
  busy: string | null;
  onRun: RunAction;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(pack.resources.map((r) => [r.item_key, String(r.qty)])),
  );

  const recorded = pack.resources.filter((r) => r.qty > 0);

  const save = () =>
    onRun("resources", () =>
      putResources(
        pack.callout.id,
        RESOURCE_ITEMS.map((key) => ({ item_key: key, qty: Number(draft[key] ?? 0) }))
          .filter((l) => Number.isFinite(l.qty) && l.qty > 0),
      ),
    ).then(() => setOpen(false));

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>
          <Package className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
          {t("Расход средств")}
        </SectionLabel>
        {editable && (
          <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
            {open ? t("Отмена") : recorded.length ? t("Изменить") : t("Внести")}
          </Button>
        )}
      </div>

      {!open &&
        (recorded.length === 0 ? (
          <EmptyState
            className="mt-2 py-4"
            icon={Package}
            title={t("Расход не внесён")}
            description={t("Заполняется после ликвидации — что израсходовано на тушении.")}
          />
        ) : (
          <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {recorded.map((r) => (
              <li key={r.item_key} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-muted">{t(RESOURCE_META[r.item_key].label)}</span>
                <span className="tabular font-medium text-fg">
                  {r.qty} <span className="text-xs text-faint">{t(RESOURCE_META[r.item_key].unit)}</span>
                </span>
              </li>
            ))}
          </ul>
        ))}

      {open && editable && (
        <div className="mt-3 space-y-2">
          {RESOURCE_ITEMS.map((key) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <label htmlFor={`res-${key}`} className="truncate text-sm text-muted">
                {t(RESOURCE_META[key].label)}
              </label>
              <div className="flex shrink-0 items-center gap-2">
                <Input
                  id={`res-${key}`}
                  type="number"
                  min={0}
                  step="0.1"
                  inputMode="decimal"
                  className="w-24 text-right tabular"
                  value={draft[key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                />
                <span className="w-8 text-xs text-faint">{t(RESOURCE_META[key].unit)}</span>
              </div>
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              {t("Отмена")}
            </Button>
            <Button size="sm" onClick={save} disabled={busy === "resources"}>
              {busy === "resources" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t("Сохранить")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
