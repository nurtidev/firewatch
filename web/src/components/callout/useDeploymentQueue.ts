"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import type { DeploymentPosition } from "@/lib/dispatch";
import {
  clearRejected,
  flushDeployment,
  pendingCount,
  pendingFor,
  rejectedFor,
  type Pending,
  type RejectedEntry,
} from "@/lib/deploymentQueue";
import { isOnline } from "@/lib/offline";

/**
 * Очередь расстановки: единственный путь, которым позиции уходят на сервер.
 *
 * Онлайн и оффлайн здесь не две ветки, а одна: жест кладёт намерение в
 * очередь и тут же пытается её отправить. Со связью оверлей живёт
 * миллисекунды, без связи — до её возвращения. Разделять пути было бы
 * опаснее, чем кажется: самая частая беда поля — не «offline», а связь,
 * которая есть по флагу и не работает по факту, и она попадала бы ровно в ту
 * ветку, которую никто не проверял на демо.
 *
 * Хук живёт в CalloutOps — над разделами, а не внутри «Расстановки»: переход
 * на другой раздел не должен ни терять состояние очереди, ни перезапускать
 * отправку, а её баннеры и счётчик видны с любого раздела.
 */
export function useDeploymentQueue(calloutId: number, onChanged: () => void) {
  // Очередь привязана к учётной записи (см. lib/deploymentQueue): при смене
  // пользователя на общем планшете её надо перечитать — чужая не показывается.
  const { user } = useAuth();
  const owner = user?.username ?? null;
  const [pending, setPending] = useState<Pending[]>([]);
  const [rejected, setRejected] = useState<RejectedEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [retryReason, setRetryReason] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  // 403: прав на расстановку в этом выезде нет. Повтор даст тот же отказ,
  // поэтому сама очередь больше не уходит — ни по жесту, ни по возврату
  // связи — до смены учётной записи или ручного «Отправить». Ref, а не только
  // состояние: жест и событие `online` читают его синхронно.
  const [forbidden, setForbidden] = useState(false);
  const forbiddenRef = useRef(false);
  useEffect(() => {
    forbiddenRef.current = false;
    setForbidden(false);
  }, [owner, calloutId]);
  // Расстановка из ответа синхронизации: держит принятую позицию на плане в
  // те доли секунды, пока едет свежий боевой пакет.
  const [synced, setSynced] = useState<DeploymentPosition[] | null>(null);

  // onChanged приходит сверху и не обязан быть стабильным. В зависимостях
  // flush он пересоздавал бы отправку на каждый рендер, а эффект подписки
  // ниже — отправлял очередь заново при каждой перерисовке.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const refresh = useCallback(() => {
    setPending(pendingFor(calloutId));
    setRejected(rejectedFor(calloutId));
  }, [calloutId]);

  useEffect(() => {
    refresh();
  }, [refresh, owner]);

  /** `manual` — человек нажал «Отправить»: только так уходит очередь после 403. */
  const flush = useCallback(async (manual = false) => {
    if (pendingCount(calloutId) === 0) {
      setAuthRequired(false);
      forbiddenRef.current = false;
      setForbidden(false);
      return;
    }
    if (!manual && forbiddenRef.current) return;
    setSyncing(true);
    try {
      const out = await flushDeployment(calloutId);
      setRetryReason(out.retryReason ?? null);
      setAuthRequired(Boolean(out.authRequired));
      forbiddenRef.current = Boolean(out.forbidden);
      setForbidden(Boolean(out.forbidden));
      if (out.positions) setSynced(out.positions);
      if (out.applied > 0 || out.rejected > 0) onChangedRef.current();
    } finally {
      setSyncing(false);
      refresh();
    }
  }, [calloutId, refresh]);

  // Очередь уходит сама: при открытии выезда, при входе владельца и как
  // только вернулась связь. Кнопка «Отправить» — для случая, когда
  // navigator.onLine врёт.
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void flush();
    };
    const onOffline = () => setOnline(false);
    setOnline(isOnline());
    void flush();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flush, owner]);

  /** Записать жест в очередь и сразу попробовать отправить. */
  const apply = useCallback(
    (fn: () => void) => {
      fn();
      refresh();
      void flush();
    },
    [flush, refresh],
  );

  const dismissRejected = useCallback(() => {
    clearRejected(calloutId);
    refresh();
  }, [calloutId, refresh]);

  return {
    pending,
    rejected,
    syncing,
    retryReason,
    authRequired,
    forbidden,
    synced,
    setSynced,
    online,
    flush,
    apply,
    dismissRejected,
  };
}

export type DeploymentQueue = ReturnType<typeof useDeploymentQueue>;
