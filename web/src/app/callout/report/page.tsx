"use client";

/**
 * Донесение о пожаре — печатная форма по выезду.
 *
 * Сегодня это делается так: РТП пишет донесение в Word, а схему расстановки
 * рисует отдельно (в части — в Visio, на выезде — от руки) и подшивает
 * приложением. Данные при этом переписываются из памяти и из блокнота, и
 * расходятся с тем, что зафиксировано в системе, — а разбор пожара потом
 * идёт по бумаге.
 *
 * Здесь документ собирается из того, что уже записано на выезде: хронология
 * с интервалами, наряд техники против расчёта по методике, расход средств и
 * расстановка сил — та же схема, что вёл РТП пальцем на планшете. Печать
 * идёт через браузер (Ctrl+P → «Сохранить как PDF»): системный диалог даёт и
 * бумагу, и файл, а схема остаётся векторной, а не скриншотом.
 *
 * Правила, которые здесь не косметические:
 *   • **Светлая тема принудительно.** Боевые экраны тёмные; тёмный документ
 *     на бумаге — это залитый тонером лист, который невозможно читать.
 *   • **Незакрытый выезд печатается с пометкой.** Штабу схема нужна по ходу
 *     тушения, но донесение по незавершённому выезду — предварительное, и
 *     лист обязан говорить это сам, без сопроводительной записки.
 *   • **Один лист — один этаж и один этап.** Расстановка на локализации и на
 *     ликвидации различается; наложенные, они не читаются.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Printer, ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import DeploymentSheet, { type NumberedPosition } from "@/components/DeploymentSheet";
import StaleDataBanner from "@/components/StaleDataBanner";
import { Button, Skeleton, Banner } from "@/components/ui";
import { apiFetch, useAuth } from "@/lib/auth";
import { realPlanForFloor } from "@/lib/realgeom";
import {
  CALLOUT_TYPE_META,
  POSITION_KIND_META,
  POSITION_PHASES,
  POSITION_PHASE_LABEL,
  RESOURCE_META,
  RESPONSE_NORM_SEC,
  TIMELINE_STEPS,
  TIMELINE_STEP_LABEL,
  VEHICLE_TYPE_META,
  formatClock,
  formatDuration,
  useCalloutPack,
  type CalloutPackData,
  type DeploymentPosition,
  type PositionPhase,
} from "@/lib/dispatch";

export default function CalloutReportPage() {
  return (
    <Suspense fallback={null}>
      <ReportInner />
    </Suspense>
  );
}

function ReportInner() {
  const params = useSearchParams();
  const idParam = params.get("id");
  const calloutId = idParam ? Number(idParam) : null;
  const { user } = useAuth();

  // Без поллинга: документ не должен меняться под руками, пока его печатают.
  // cachedAt ≠ null — пакет отдан офлайн-кэшем воркера (API молчало дольше
  // 4 с). Официальный документ по такому снимку печатать можно — штабу он
  // нужен и без связи, — но лист обязан сам говорить, что данные не живые.
  const { pack, loading, error, cachedAt } = useCalloutPack(calloutId);

  return (
    <div className="fw-report-root light min-h-screen bg-bg text-fg">
      <div className="fw-no-print mx-auto flex max-w-[210mm] items-center justify-between gap-3 p-4">
        <Button variant="secondary" onClick={() => window.close()}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Закрыть
        </Button>
        {calloutId != null && <PrintButton calloutId={calloutId} disabled={!pack} />}
      </div>

      <div className="mx-auto max-w-[210mm] px-4 pb-10">
        {loading && !pack && <Skeleton className="h-[240mm] w-full" />}
        {error && !pack && <Banner tone="critical">{error}</Banner>}
        {calloutId == null && (
          <Banner tone="critical">Выезд не указан — откройте донесение из боевого пакета.</Banner>
        )}
        {pack && <StaleDataBanner cachedAt={cachedAt} kind="report" className="fw-no-print mb-3" />}
        {pack?.callout.status === "active" && <Watermark />}
        {pack && (
          <Report pack={pack} cachedAt={cachedAt} author={user?.name ?? user?.username ?? ""} />
        )}
      </div>
    </div>
  );
}

/** Печать фиксируется в журнале: выгрузка донесения — действие с документом,
 *  и «кто и когда его выгрузил» разбирают наравне с самим содержанием. */
function PrintButton({ calloutId, disabled }: { calloutId: number; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const print = async () => {
    setBusy(true);
    try {
      await apiFetch(`/dispatch/${calloutId}/report/export`, { method: "POST" });
    } catch {
      // Журнал не должен мешать печати: связь могла пропасть, а донесение
      // нужно сейчас.
    } finally {
      setBusy(false);
      window.print();
    }
  };
  return (
    <Button onClick={print} disabled={disabled || busy}>
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Printer className="h-4 w-4" aria-hidden />
      )}
      Печать
    </Button>
  );
}

/* ───────────────────────────── Документ ───────────────────────────── */

const dateRu = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

function Report({
  pack,
  author,
  cachedAt,
}: {
  pack: CalloutPackData;
  author: string;
  cachedAt: string | null;
}) {
  const callout = pack.callout;
  const preliminary = callout.status === "active";

  const [card, setCard] = useState<{ extracted?: Record<string, unknown> } | null>(null);
  const cardId = pack.building?.card_id ?? null;
  useEffect(() => {
    if (cardId == null) return;
    apiFetch(`/cards/${cardId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCard(d))
      .catch(() => {});
  }, [cardId]);

  const objectName = (card?.extracted as { object?: { name?: string } } | undefined)?.object?.name;

  // Сквозная нумерация по всему донесению: номер на схеме и номер в сводной
  // таблице — один и тот же, иначе лист схемы нельзя читать отдельно.
  const numbered: NumberedPosition[] = useMemo(() => {
    const order = (p: DeploymentPosition) =>
      `${POSITION_PHASES.indexOf(p.phase)}|${p.floor ?? ""}|${String(p.id).padStart(10, "0")}`;
    return [...(pack.deployment ?? [])]
      .sort((a, b) => order(a).localeCompare(order(b)))
      .map((p, i) => ({ ...p, no: i + 1 }));
  }, [pack.deployment]);

  // Листы схемы: (этап × этаж), где есть позиции с планом и сам план известен.
  const sheets = useMemo(() => {
    const out: { phase: PositionPhase; floor: string; positions: NumberedPosition[] }[] = [];
    for (const phase of POSITION_PHASES) {
      const floors = [
        ...new Set(
          numbered
            .filter((p) => p.phase === phase && p.plan_x != null && p.floor)
            .map((p) => p.floor as string),
        ),
      ];
      for (const floor of floors) {
        out.push({
          phase,
          floor,
          positions: numbered.filter(
            (p) => p.phase === phase && p.floor === floor && p.plan_x != null,
          ),
        });
      }
    }
    return out;
  }, [numbered]);

  return (
    <>
      <article className="fw-sheet relative mx-auto bg-surface p-[10mm] text-xs shadow-sm">
        <header className="border-b-2 border-border-strong pb-2 text-center">
          <h1 className="text-base font-bold uppercase tracking-wide">Донесение о пожаре</h1>
          <p className="mt-0.5 text-2xs text-muted">
            к боевому выезду № <span className="tabular">{callout.id}</span> от{" "}
            {dateRu(callout.created_at)}
            {preliminary && " · предварительное, выезд не закрыт"}
          </p>
          <SnapshotMark cachedAt={cachedAt} />
        </header>

        <Section title="1. Объект и вызов">
          <Rows
            rows={[
              ["Адрес", callout.address ?? "—"],
              ["Объект", objectName ?? "—"],
              ["Район", callout.district ?? "—"],
              ["Характер вызова", CALLOUT_TYPE_META[callout.callout_type].label],
              [
                "Этажность",
                pack.building?.floors != null
                  ? `${pack.building.floors} (${pack.building.floors_source === "card" ? "по ПТП" : "по реестру"})`
                  : "—",
              ],
              ["Пожарная часть", callout.station?.name ?? "—"],
              [
                "Расстояние до части",
                pack.station?.distance_m != null ? `${(pack.station.distance_m / 1000).toFixed(1)} км` : "—",
              ],
              ["Ранг пожара", callout.timeline.rank_declared ?? "—"],
            ]}
          />
          {callout.note && (
            <p className="mt-1.5 text-2xs text-muted">Сообщение о пожаре: {callout.note}</p>
          )}
        </Section>

        <Section title="2. Хронология боевых действий">
          <table className="fw-keep w-full border-collapse text-2xs">
            <thead>
              <tr className="border-b border-border text-left text-faint">
                <th className="py-1 font-medium">Событие</th>
                <th className="w-20 py-1 font-medium">Время</th>
                <th className="py-1 font-medium">От сообщения</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60">
                <td className="py-1">Сообщение о пожаре</td>
                <td className="tabular py-1">{formatClock(callout.timeline.reported_at)}</td>
                <td className="py-1">—</td>
              </tr>
              {TIMELINE_STEPS.map((step) => (
                <tr key={step} className="border-b border-border/60">
                  <td className="py-1">{TIMELINE_STEP_LABEL[step]}</td>
                  <td className="tabular py-1">{formatClock(callout.timeline[step])}</td>
                  <td className="tabular py-1">{sinceReport(callout.timeline.reported_at, callout.timeline[step])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Rows
            className="mt-2"
            rows={[
              ["Сбор и выезд", formatDuration(callout.timeline.turnout_sec)],
              ["Следование", formatDuration(callout.timeline.travel_sec)],
              [
                "Время реагирования",
                `${formatDuration(callout.timeline.response_sec)}${
                  callout.timeline.response_sec != null
                    ? callout.timeline.response_sec > RESPONSE_NORM_SEC
                      ? " · превышение норматива 10 мин"
                      : " · в пределах норматива 10 мин"
                    : ""
                }`,
              ],
              ["Общее время работы", formatDuration(callout.timeline.total_sec)],
            ]}
          />
        </Section>

        <Section title="3. Силы и средства">
          {pack.vehicles.length === 0 ? (
            <p className="text-2xs text-muted">Наряд техники не зафиксирован.</p>
          ) : (
            <table className="fw-keep w-full border-collapse text-2xs">
              <thead>
                <tr className="border-b border-border text-left text-faint">
                  <th className="w-8 py-1 font-medium">№</th>
                  <th className="py-1 font-medium">Позывной</th>
                  <th className="py-1 font-medium">Тип</th>
                  <th className="py-1 font-medium">Часть</th>
                  <th className="w-20 py-1 font-medium">Назначена</th>
                </tr>
              </thead>
              <tbody>
                {pack.vehicles.map((v, i) => (
                  <tr key={v.id} className="border-b border-border/60">
                    <td className="tabular py-1">{i + 1}</td>
                    <td className="py-1 font-medium">{v.callsign}</td>
                    <td className="py-1">{VEHICLE_TYPE_META[v.vehicle_type].label}</td>
                    <td className="py-1">{v.station_name ?? "—"}</td>
                    <td className="tabular py-1">{formatClock(v.assigned_at ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {pack.forces_hint && (
            <div className="mt-2">
              <p className="text-2xs text-faint">
                Расчёт по методике
                {pack.forces_hint.source === "card"
                  ? " (по ПТП объекта)"
                  : " (ориентировочный, по типу объекта)"}
                :
              </p>
              <Rows
                rows={[
                  ["Стволы на тушение", cmp(countKind(pack.deployment, "barrel_ext"), pack.forces_hint.barrels_ext)],
                  ["Стволы на защиту", cmp(countKind(pack.deployment, "barrel_def"), pack.forces_hint.barrels_def)],
                  ["Отделений по расчёту", num(pack.forces_hint.squads)],
                  ["Личный состав по расчёту", num(pack.forces_hint.personnel)],
                  ["Требуемый расход воды", pack.forces_hint.q_req_l_s != null ? `${pack.forces_hint.q_req_l_s} л/с` : "—"],
                ]}
              />
            </div>
          )}
        </Section>

        <Section title="4. Расход средств">
          {pack.resources.length === 0 ? (
            <p className="text-2xs text-muted">Расход не зафиксирован.</p>
          ) : (
            <Rows
              rows={pack.resources.map((r) => [
                RESOURCE_META[r.item_key].label,
                `${r.qty} ${RESOURCE_META[r.item_key].unit}`,
              ])}
            />
          )}
        </Section>

        <Section title="5. Расстановка сил и средств">
          {numbered.length === 0 ? (
            <p className="text-2xs text-muted">Расстановка не зафиксирована.</p>
          ) : (
            <>
              <table className="fw-keep w-full border-collapse text-2xs">
                <thead>
                  <tr className="border-b border-border text-left text-faint">
                    <th className="w-8 py-1 font-medium">№</th>
                    <th className="py-1 font-medium">Этап</th>
                    <th className="py-1 font-medium">Позиция</th>
                    <th className="py-1 font-medium">Место</th>
                    <th className="w-16 py-1 font-medium">Напр.</th>
                    <th className="w-16 py-1 font-medium">Время</th>
                  </tr>
                </thead>
                <tbody>
                  {numbered.map((p) => (
                    <tr key={p.id} className="border-b border-border/60">
                      <td className="tabular py-1 font-semibold">{p.no}</td>
                      <td className="py-1">{POSITION_PHASE_LABEL[p.phase]}</td>
                      <td className="py-1">{POSITION_KIND_META[p.kind].label}</td>
                      <td className="py-1">{p.sector || p.floor || "—"}</td>
                      <td className="tabular py-1">
                        {POSITION_KIND_META[p.kind].directional && p.heading != null
                          ? `${p.heading}°`
                          : "—"}
                      </td>
                      <td className="tabular py-1">{formatClock(p.placed_at ?? p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {sheets.length > 0 && (
                <p className="mt-1.5 text-2xs text-faint">
                  Схемы расстановки — на отдельных листах, приложение к настоящему донесению
                  (листов: {sheets.length}).
                </p>
              )}
            </>
          )}
        </Section>

        <Signatures author={author} callout={pack.callout} />
      </article>

      {sheets.map((sheet) => {
        const plan = realPlanForFloor(objectName, sheet.floor);
        return (
          <article
            key={`${sheet.phase}-${sheet.floor}`}
            className="fw-sheet relative mx-auto mt-6 bg-surface p-[10mm] text-xs shadow-sm"
          >
            <header className="border-b border-border-strong pb-1.5">
              <h2 className="text-sm font-bold uppercase tracking-wide">
                Схема расстановки сил и средств
              </h2>
              <p className="mt-0.5 text-2xs text-muted">
                Выезд № <span className="tabular">{pack.callout.id}</span> ·{" "}
                {pack.callout.address ?? "—"} · {sheet.floor} ·{" "}
                {POSITION_PHASE_LABEL[sheet.phase]}
              </p>
              <SnapshotMark cachedAt={cachedAt} align="left" />
            </header>
            <div className="mt-3">
              {plan ? (
                <DeploymentSheet plan={plan} positions={sheet.positions} />
              ) : (
                <p className="text-2xs text-muted">
                  Поэтажный план объекта не оцифрован — позиции этого этажа приведены таблицей в
                  разделе 5.
                </p>
              )}
            </div>
            <Signatures author={author} callout={pack.callout} compact />
          </article>
        );
      })}
    </>
  );
}

/* ───────────────────────────── Мелочи листа ───────────────────────────── */

/**
 * Пометка на самом листе: данные взяты из сохранённого снимка, а не с
 * сервера. Печатается на каждом листе — их подшивают по отдельности, и лист
 * схемы без пометки выглядел бы подтверждённым. Текст документа русский, как
 * и весь лист; значок рядом, чтобы пометка не держалась на одном цвете.
 */
function SnapshotMark({
  cachedAt,
  align = "center",
}: {
  cachedAt: string | null;
  align?: "center" | "left";
}) {
  if (cachedAt == null) return null;
  const when = cachedAt
    ? `от ${dateRu(cachedAt)} ${formatClock(cachedAt)}`
    : "без отметки времени";
  return (
    <p
      className={`mt-1 flex items-center gap-1 text-2xs font-semibold text-critical ${
        align === "center" ? "justify-center" : ""
      }`}
    >
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
      <span className="tabular">Снимок данных {when}, не подтверждён сервером</span>
    </p>
  );
}

function Watermark() {
  return (
    <div
      className="fw-watermark pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden"
      aria-hidden
    >
      <span className="-rotate-[24deg] text-[54px] font-bold uppercase tracking-widest text-critical/10">
        Предварительно
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h2 className="fw-section-title mb-1.5 border-b border-border pb-0.5 text-2xs font-bold uppercase tracking-wider text-fg">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Rows({ rows, className }: { rows: [string, string][]; className?: string }) {
  return (
    <dl className={`grid grid-cols-[minmax(0,42%)_minmax(0,58%)] gap-x-3 text-2xs ${className ?? ""}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="border-b border-border/50 py-1 text-muted">{k}</dt>
          <dd className="tabular border-b border-border/50 py-1 text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Signatures({
  author,
  callout,
  compact,
}: {
  author: string;
  callout: CalloutPackData["callout"];
  compact?: boolean;
}) {
  return (
    <footer className={`fw-keep ${compact ? "mt-4" : "mt-6"} grid grid-cols-2 gap-6 text-2xs`}>
      <div>
        <div className="h-6 border-b border-border-strong" />
        <div className="mt-0.5 text-faint">
          Руководитель тушения пожара (подпись, звание, фамилия)
        </div>
      </div>
      <div>
        <div className="flex h-6 items-end border-b border-border-strong">
          <span className="text-fg">{author}</span>
        </div>
        <div className="mt-0.5 text-faint">
          Составил · {new Date().toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
          {callout.closed_by ? ` · выезд закрыл: ${callout.closed_by}` : ""}
        </div>
      </div>
    </footer>
  );
}

/* ───────────────────────────── Хелперы ───────────────────────────── */

const num = (v: number | null) => (v != null ? String(v) : "—");

/** «3 из 4 по расчёту» — то же сравнение факта с методикой, что на экране. */
function cmp(actual: number, need: number | null): string {
  return need != null ? `${actual} из ${need} по расчёту` : `${actual} (расчёт не задан)`;
}

function countKind(positions: DeploymentPosition[] | undefined, kind: string): number {
  return (positions ?? []).filter((p) => p.kind === kind).length;
}

/** Интервал от сообщения о пожаре до отметки — так его пишут в донесении. */
function sinceReport(reported: string | null, mark: string | null): string {
  if (!reported || !mark) return "—";
  const sec = Math.round((new Date(mark).getTime() - new Date(reported).getTime()) / 1000);
  return sec < 0 ? "—" : formatDuration(sec);
}
