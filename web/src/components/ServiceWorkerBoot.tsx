"use client";

/**
 * Регистрация Service Worker и предложение обновиться.
 *
 * Обновление не применяется само: перезагрузка боевого экрана посреди выезда
 * прерывает работу РТП ради версии, которая подождёт. Поэтому новый воркер
 * ждёт, а решение принимает человек — как и всё остальное в этом модуле.
 * Если обновление применили в другой вкладке, эта не перезагружается сама:
 * здесь может быть диспетчер посреди регистрации вызова. Она только
 * подсказывает, что код на экране устарел.
 *
 * Полоса намеренно внизу и узкая: на планшете верх экрана занят боевым
 * пакетом, и уведомление о версии не имеет права закрывать адрес объекта.
 */

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { registerServiceWorker, type SwUpdate } from "@/lib/sw";

export default function ServiceWorkerBoot() {
  const t = useT();
  const [update, setUpdate] = useState<SwUpdate | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(
    () =>
      registerServiceWorker((next) => {
        setUpdate(next);
        setDismissed(false);
      }),
    [],
  );

  if (!update || dismissed) return null;

  const activated = update.kind === "activated";

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-3 print:hidden">
      <div
        role="status"
        aria-live="polite"
        className="flex max-w-full flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 shadow-lg"
      >
        <RefreshCw className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 text-xs text-fg">
          {activated
            ? t("Приложение обновлено в другой вкладке — перезагрузите страницу, когда будет удобно")
            : t("Доступна новая версия приложения")}
        </span>
        <Button size="sm" onClick={update.kind === "activated" ? update.reload : update.apply}>
          {activated ? t("Перезагрузить") : t("Обновить")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDismissed(true)}
          aria-label={t("Отложить обновление")}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
