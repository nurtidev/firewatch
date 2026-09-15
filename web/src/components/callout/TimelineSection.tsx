"use client";

/**
 * Хронология выезда. Отметка ставится «сейчас» одним нажатием — в кабине и на
 * месте пожара никто не набирает время руками. Ошибочную отметку можно снять
 * тем же нажатием. Ни одна отметка не выставляется автоматически.
 */
import { AlertTriangle, Check, Clock, FileText, Loader2, X } from "lucide-react";
import { Button, Card, SectionLabel, StatusChip } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { SEVERITY } from "@/lib/risk";
import {
  RESPONSE_NORM_SEC,
  TIMELINE_STEPS,
  TIMELINE_STEP_LABEL,
  formatClock,
  formatDuration,
  patchTimeline,
  type CalloutPackData,
  type TimelineStep,
} from "@/lib/dispatch";
import type { RunAction } from "./types";

export default function TimelineSection({
  pack,
  editable,
  large,
  busy,
  onRun,
}: {
  pack: CalloutPackData;
  /** Документальное действие: разрешено и на закрытом выезде (см. CalloutOps). */
  editable: boolean;
  large?: boolean;
  busy: string | null;
  onRun: RunAction;
}) {
  const t = useT();
  const callout = pack.callout;
  const timeline = callout.timeline;

  const toggleMark = (step: TimelineStep) =>
    onRun(step, () =>
      patchTimeline(callout.id, {
        [step]: timeline[step] ? null : new Date().toISOString(),
      }),
    );

  const overNorm =
    timeline.response_sec != null && timeline.response_sec > RESPONSE_NORM_SEC;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>
          <Clock className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
          {t("Хронология выезда")}
        </SectionLabel>
        <div className="flex items-center gap-2">
          {timeline.response_sec != null && (
            <StatusChip
              severity={overNorm ? SEVERITY.critical : SEVERITY.normal}
              label={`${t("Прибытие")}: ${formatDuration(timeline.response_sec)}`}
            />
          )}
          {/* Донесение открывается в отдельной вкладке: боевой пакет на
              планшете закрывать нельзя — по нему продолжают работать. */}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => window.open(`/callout/report?id=${callout.id}`, "_blank")}
          >
            <FileText className="h-4 w-4" aria-hidden />
            {t("Донесение")}
          </Button>
        </div>
      </div>

      <p className="mt-1 text-xs text-faint">
        {t("Сообщение о пожаре")} — {formatClock(timeline.reported_at)}
        {overNorm && (
          <span className="ml-2 text-critical">
            <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />
            {t("сверх норматива 10 мин")}
          </span>
        )}
      </p>

      <ol className="mt-3 space-y-2">
        {TIMELINE_STEPS.map((step, i) => {
          const at = timeline[step];
          const done = Boolean(at);
          // Следующий шаг подсвечивается как ожидаемый — в кабине нужно
          // видеть, что нажимать дальше, без чтения всех строк.
          const isNext = !done && TIMELINE_STEPS.slice(0, i).every((s) => timeline[s]);
          return (
            <li
              key={step}
              className={cn(
                "flex items-center justify-between gap-3 rounded-md border px-3 py-2",
                done
                  ? "border-border bg-surface-2"
                  : isNext
                    ? "border-accent/40 bg-accent/5"
                    : "border-border/60",
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold tabular",
                    done
                      ? "bg-normal/15 text-normal"
                      : "bg-surface-3 text-faint",
                  )}
                  aria-hidden
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={cn("truncate text-sm", done ? "text-fg" : "text-muted")}>
                  {t(TIMELINE_STEP_LABEL[step])}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="tabular text-sm text-muted">{formatClock(at)}</span>
                {editable && (
                  <Button
                    size={large ? "lg" : "sm"}
                    variant={done ? "ghost" : "secondary"}
                    onClick={() => toggleMark(step)}
                    disabled={busy === step}
                    aria-label={
                      done
                        ? `${t("Снять отметку")}: ${t(TIMELINE_STEP_LABEL[step])}`
                        : `${t("Отметить")}: ${t(TIMELINE_STEP_LABEL[step])}`
                    }
                  >
                    {busy === step ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : done ? (
                      <X className="h-4 w-4" aria-hidden />
                    ) : (
                      t("Отметить")
                    )}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {(timeline.turnout_sec != null || timeline.total_sec != null) && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3 text-xs text-muted">
          {timeline.turnout_sec != null && (
            <span>
              {t("Сбор караула")}:{" "}
              <span className="tabular text-fg">{formatDuration(timeline.turnout_sec)}</span>
            </span>
          )}
          {timeline.travel_sec != null && (
            <span>
              {t("В пути")}:{" "}
              <span className="tabular text-fg">{formatDuration(timeline.travel_sec)}</span>
            </span>
          )}
          {timeline.total_sec != null && (
            <span>
              {t("Всего до ликвидации")}:{" "}
              <span className="tabular text-fg">{formatDuration(timeline.total_sec)}</span>
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
