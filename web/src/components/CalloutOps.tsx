"use client";

/**
 * Рабочее место по выезду на планшете РТП (/callout): боевой пакет и
 * оперативный блок — хронология боевых действий, наряд сил и расход средств,
 * расстановка — разложены по вкладкам. Одним длинным полотном это означало
 * листать в перчатках посреди пожара.
 *
 * Принцип, определяющий весь этот экран: система *предлагает* расчёт по
 * методике, а отметки ставит человек. Ни одна отметка времени не выставляется
 * автоматически — даже там, где её можно было бы вывести. Автоматика придёт
 * тогда, когда появится доверенный источник (телематика системы мониторинга),
 * и заменит собой ручной ввод, а не решение РТП.
 *
 * Разделы — отдельные компоненты в components/callout/. Здесь остаётся то,
 * что общее для них и обязано переживать переход между вкладками: ошибка и
 * «занятая» кнопка последнего действия, очередь расстановки и баннеры
 * (CalloutBanners — над вкладками, видны с любой). Панели не размонтируются
 * при переключении, а только скрываются: черновик расхода, открытая форма
 * позиции, выбранный этаж схемы и выбор техники остаются на месте.
 *
 * Активная вкладка — в адресе (`?tab=timeline|crew|plan`, без параметра —
 * «Пакет») и переживает перезагрузку. Запись — replaceState, а не новая
 * запись истории: «назад» уводит с выезда, а не листает вкладки, и после
 * «К списку» в истории не остаётся выезда, из которого только что вышли.
 */
import { useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ClipboardList, Clock, CloudOff, CloudUpload, MapIcon, Truck } from "lucide-react";
import { Tabs, tabIds, type TabItem } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { SEVERITY, type Severity } from "@/lib/risk";
import { CATEGORY_META } from "@/lib/reports";
import {
  BLOCKING_REPORT_CATEGORIES,
  TIMELINE_STEPS,
  type CalloutPackData,
} from "@/lib/dispatch";
import TimelineSection from "@/components/callout/TimelineSection";
import VehiclesSection, { crewVsHint } from "@/components/callout/VehiclesSection";
import DeploymentSection from "@/components/callout/DeploymentSection";
import ResourcesSection from "@/components/callout/ResourcesSection";
import CalloutBanners, { type ActionError } from "@/components/callout/CalloutBanners";
import { useDeploymentQueue } from "@/components/callout/useDeploymentQueue";
import type { RunAction } from "@/components/callout/types";

export const CALLOUT_TABS = ["pack", "timeline", "crew", "plan"] as const;
export type CalloutTab = (typeof CALLOUT_TABS)[number];
const DEFAULT_TAB: CalloutTab = "pack";

const isCalloutTab = (v: string | null): v is CalloutTab =>
  v != null && (CALLOUT_TABS as readonly string[]).includes(v);

/** От самого тяжёлого к лёгкому — для счётчика препятствий на «Пакете». */
const SEVERITY_ORDER: Severity[] = ["critical", "high", "elevated", "normal", "info"];

export default function CalloutOps({
  pack,
  cachedAt = null,
  onChanged,
  canEdit,
  large,
  packPanel,
}: {
  pack: CalloutPackData;
  /** Пакет отдан офлайн-кэшем (см. useCalloutPack): пометка над вкладками и
   *  отдельно — рядом со схемой расстановки. */
  cachedAt?: string | null;
  onChanged: () => void;
  /** Диспетчер и РТП ставят отметки; надзорные роли смотрят только чтение. */
  canEdit: boolean;
  large?: boolean;
  /** Содержимое вкладки «Пакет» — боевой пакет (CalloutPack) собирает страница. */
  packPanel: ReactNode;
}) {
  const t = useT();
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const callout = pack.callout;
  const closed = callout.status === "closed";
  // Граница проходит не по «закрыт / не закрыт», а по смыслу действия.
  // Оперативные (наряд, расстановка) на закрытом выезде запрещает сервер —
  // силами закрытого выезда уже не распоряжаются. Документальные (хронология,
  // расход) он разрешает: их уточняют позже, когда РТП садится составлять
  // донесение о пожаре. Интерфейс обязан повторять ровно это различие.
  // Исключение одно — очередь планшета: то, что РТП поставил без связи до
  // закрытия, сервер принимает и после него (с пометкой), поэтому очередь
  // закрытого выезда отправляется и её состояние видно (CalloutBanners).
  const editable = canEdit && !closed;
  const documentEditable = canEdit;

  /** Действие раздела: ошибка запоминает, в каком разделе она случилась —
   *  баннер виден с любой вкладки и должен говорить, что именно повторить. */
  const runIn =
    (section: string): RunAction =>
    async (key, fn) => {
      setBusy(key);
      setError(null);
      try {
        await fn();
        onChanged();
      } catch (e) {
        setError({
          section,
          message: e instanceof Error ? e.message : t("Не удалось сохранить изменение"),
        });
      } finally {
        setBusy(null);
      }
    };

  const queue = useDeploymentQueue(callout.id, onChanged);
  // Состояние очереди видно и на закрытом выезде, пока на устройстве что-то
  // лежит: сервер досинхронизирует поставленное до закрытия, и РТП должен
  // знать, что расстановка ещё не ушла. Ставить новое там по-прежнему нельзя.
  const showQueue = editable || queue.pending.length > 0;

  /* ───────────────────────── Вкладка в адресе ───────────────────────── */

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const rawTab = searchParams.get("tab");
  const tab: CalloutTab = isCalloutTab(rawTab) ? rawTab : DEFAULT_TAB;
  const anchorRef = useRef<HTMLDivElement>(null);

  const selectTab = (id: string) => {
    if (!isCalloutTab(id)) return;
    // Сравниваем с адресом, а не с useSearchParams: при быстрых нажатиях он
    // отстаёт на рендер, и одна и та же вкладка записывалась бы повторно.
    const params = new URLSearchParams(window.location.search);
    const current = params.get("tab");
    if ((isCalloutTab(current) ? current : DEFAULT_TAB) === id) return;
    if (id === DEFAULT_TAB) params.delete("tab");
    else params.set("tab", id);
    const qs = params.toString();
    // history.replaceState, а не router.replace: Next синхронизирует его с
    // useSearchParams без запроса RSC-пейлоада. Роутер на планшете без связи
    // ушёл бы в сеть и откатился на жёсткую навигацию — вкладка обязана
    // переключаться и в подвале без покрытия.
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    // Лента вкладок прилипла сверху — новый раздел начинается под ней, а не с
    // середины, куда был прокручен прошлый.
    const anchor = anchorRef.current;
    if (anchor) {
      const viewportTop = anchor.closest("main")?.getBoundingClientRect().top ?? 0;
      if (anchor.getBoundingClientRect().top < viewportTop) {
        anchor.scrollIntoView({ block: "start" });
      }
    }
  };

  /* ─────── Счётчики на вкладках: severity та же, что у чипа/баннера того же факта ─────── */

  const blocking = pack.reports.filter((r) => BLOCKING_REPORT_CATEGORIES.includes(r.category));
  const blockingKey = SEVERITY_ORDER.find((k) =>
    blocking.some((r) => CATEGORY_META[r.category].severity.key === k),
  );
  const packBadge: Partial<TabItem> =
    blocking.length > 0 && blockingKey
      ? {
          count: blocking.length,
          countSeverity: SEVERITY[blockingKey],
          countLabel: t("Препятствия проезда: {n}").replace("{n}", String(blocking.length)),
        }
      : {};

  const marked = TIMELINE_STEPS.filter((s) => callout.timeline[s]).length;
  const timelineBadge: Partial<TabItem> = {
    count: `${marked}/${TIMELINE_STEPS.length}`,
    countLabel: t("Отмечено этапов: {n} из {total}")
      .replace("{n}", String(marked))
      .replace("{total}", String(TIMELINE_STEPS.length)),
  };

  const crew = crewVsHint(pack);
  const crewBadge: Partial<TabItem> =
    crew.needed != null
      ? {
          count: `${crew.assigned}/${crew.needed}`,
          countSeverity: crew.severity,
          countLabel: t("Техника: {n} из {need} по расчёту")
            .replace("{n}", String(crew.assigned))
            .replace("{need}", String(crew.needed)),
        }
      : crew.assigned > 0
        ? {
            count: crew.assigned,
            countLabel: t("Назначено машин: {n}").replace("{n}", String(crew.assigned)),
          }
        : {};

  const pendingN = queue.pending.length;
  const rejectedN = queue.rejected.length;
  const placedN = (pack.deployment ?? []).length;
  // Тон очереди — как у баннера, который сейчас виден: без связи, без входа
  // или без прав — предупреждение, при связи — справка (очередь уходит).
  const queueStuck = !queue.online || queue.authRequired || queue.forbidden;
  const planBadge: Partial<TabItem> =
    rejectedN > 0
      ? {
          count: rejectedN,
          countSeverity: SEVERITY.critical,
          countIcon: CloudOff,
          countLabel: t("Не принято сервером: {n}").replace("{n}", String(rejectedN)),
        }
      : pendingN > 0
        ? {
            count: pendingN,
            countSeverity: queueStuck ? SEVERITY.elevated : SEVERITY.info,
            countIcon: CloudUpload,
            countLabel: t("Позиций ждёт отправки: {n}").replace("{n}", String(pendingN)),
          }
        : placedN > 0
          ? {
              count: placedN,
              countLabel: t("Позиций расставлено: {n}").replace("{n}", String(placedN)),
            }
          : {};

  const tabs: TabItem[] = [
    { id: "pack", label: t("Пакет"), icon: ClipboardList, ...packBadge },
    { id: "timeline", label: t("Хронология"), icon: Clock, ...timelineBadge },
    { id: "crew", label: t("Наряд и расход"), icon: Truck, ...crewBadge },
    { id: "plan", label: t("Расстановка"), icon: MapIcon, ...planBadge },
  ];

  const idPrefix = `callout-${callout.id}`;
  const panel = (id: CalloutTab, children: ReactNode) => {
    const ids = tabIds(idPrefix, id);
    return (
      <div
        role="tabpanel"
        id={ids.panel}
        aria-labelledby={ids.tab}
        hidden={tab !== id}
        tabIndex={0}
        className={cn("space-y-4", large && "space-y-5")}
      >
        {children}
      </div>
    );
  };

  return (
    <div className={cn("space-y-3", large && "space-y-4")}>
      <CalloutBanners
        queue={queue}
        showQueue={showQueue}
        cachedAt={cachedAt}
        error={error ? { ...error, section: t(error.section) } : null}
        onDismissError={() => setError(null)}
      />

      <div>
        {/* Якорь — в потоке, не липкий: по нему видно, прилипла ли лента. */}
        <div ref={anchorRef} aria-hidden />
        <div className="sticky top-0 z-20 -mt-2 bg-bg py-2">
          <Tabs
            tabs={tabs}
            active={tab}
            onChange={selectTab}
            size={large ? "lg" : "md"}
            fill
            idPrefix={idPrefix}
            aria-label={t("Разделы выезда")}
          />
        </div>

        <div className={large ? "mt-3" : "mt-2"}>
          {panel("pack", packPanel)}

          {panel(
            "timeline",
            <TimelineSection
              pack={pack}
              editable={documentEditable}
              large={large}
              busy={busy}
              onRun={runIn("Хронология")}
            />,
          )}

          {panel(
            "crew",
            <>
              <VehiclesSection
                pack={pack}
                editable={editable}
                large={large}
                busy={busy}
                onRun={runIn("Наряд сил")}
                active={tab === "crew"}
              />
              <ResourcesSection
                pack={pack}
                editable={documentEditable}
                busy={busy}
                onRun={runIn("Расход средств")}
              />
            </>,
          )}

          {panel(
            "plan",
            <DeploymentSection
              pack={pack}
              cachedAt={cachedAt}
              editable={editable}
              busy={busy}
              onRun={runIn("Расстановка")}
              queue={queue}
            />,
          )}
        </div>
      </div>
    </div>
  );
}
