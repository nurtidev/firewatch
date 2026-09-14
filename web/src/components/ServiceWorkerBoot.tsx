"use client";

/**
 * Регистрация Service Worker и предложение обновиться.
 *
 * Обновление не применяется само: перезагрузка боевого экрана посреди выезда
 * прерывает работу РТП ради версии, которая подождёт. Поэтому новый воркер
 * ждёт, а решение принимает человек — как и всё остальное в этом модуле.
 *
 * Полоса намеренно внизу и узкая: на планшете верх экрана занят боевым
 * пакетом, и уведомление о версии не имеет права закрывать адрес объекта.
 */

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui";
import { registerServiceWorker } from "@/lib/sw";

export default function ServiceWorkerBoot() {
  const [apply, setApply] = useState<(() => void) | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(
    () => registerServiceWorker((applyUpdate) => setApply(() => applyUpdate)),
    [],
  );

  if (!apply || dismissed) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-3 print:hidden">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 shadow-lg">
        <RefreshCw className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        <span className="text-xs text-fg">Доступна новая версия приложения</span>
        <Button size="sm" onClick={apply}>
          Обновить
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDismissed(true)}
          aria-label="Отложить обновление"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
