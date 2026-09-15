"use client";

/**
 * Оперативный блок выезда: хронология боевых действий, наряд сил, расстановка
 * и расход средств. Живёт под боевым пакетом на планшете РТП (/callout).
 *
 * Принцип, определяющий весь этот экран: система *предлагает* расчёт по
 * методике, а отметки ставит человек. Ни одна отметка времени не выставляется
 * автоматически — даже там, где её можно было бы вывести. Автоматика придёт
 * тогда, когда появится доверенный источник (телематика системы мониторинга),
 * и заменит собой ручной ввод, а не решение РТП.
 *
 * Разделы — отдельные компоненты в components/callout/. Здесь остаётся только
 * то, что общее для них и должно переживать переход между ними: ошибка и
 * «занятая» кнопка последнего действия и очередь расстановки со своими
 * баннерами.
 */
import { useState } from "react";
import { Banner } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { CalloutPackData } from "@/lib/dispatch";
import TimelineSection from "@/components/callout/TimelineSection";
import VehiclesSection from "@/components/callout/VehiclesSection";
import DeploymentSection from "@/components/callout/DeploymentSection";
import ResourcesSection from "@/components/callout/ResourcesSection";
import DeploymentQueueBanners from "@/components/callout/DeploymentQueueBanners";
import { useDeploymentQueue } from "@/components/callout/useDeploymentQueue";
import type { RunAction } from "@/components/callout/types";

export default function CalloutOps({
  pack,
  cachedAt = null,
  onChanged,
  canEdit,
  large,
}: {
  pack: CalloutPackData;
  /** Пакет отдан офлайн-кэшем (см. useCalloutPack): расстановка с пульта на
   *  схеме — снимок, и это должно быть видно рядом со схемой, а не только
   *  вверху экрана. */
  cachedAt?: string | null;
  onChanged: () => void;
  /** Диспетчер и РТП ставят отметки; надзорные роли смотрят только чтение. */
  canEdit: boolean;
  large?: boolean;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
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
  // закрытого выезда отправляется и её состояние видно (DeploymentQueueBanners).
  const editable = canEdit && !closed;
  const documentEditable = canEdit;

  const run: RunAction = async (key, fn) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Не удалось сохранить изменение"));
    } finally {
      setBusy(null);
    }
  };

  const queue = useDeploymentQueue(callout.id, onChanged);
  // Состояние очереди видно и на закрытом выезде, пока на устройстве что-то
  // лежит: сервер досинхронизирует поставленное до закрытия, и РТП должен
  // знать, что расстановка ещё не ушла. Ставить новое там по-прежнему нельзя.
  const showQueue = editable || queue.pending.length > 0;

  return (
    <div className={cn("space-y-4", large && "space-y-5")}>
      {error && <Banner tone="critical">{error}</Banner>}
      <DeploymentQueueBanners queue={queue} showQueue={showQueue} />

      <TimelineSection
        pack={pack}
        editable={documentEditable}
        large={large}
        busy={busy}
        onRun={run}
      />

      <VehiclesSection pack={pack} editable={editable} large={large} busy={busy} onRun={run} />

      <DeploymentSection
        pack={pack}
        cachedAt={cachedAt}
        editable={editable}
        busy={busy}
        onRun={run}
        queue={queue}
      />

      <ResourcesSection pack={pack} editable={documentEditable} busy={busy} onRun={run} />
    </div>
  );
}
