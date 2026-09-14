"use client";

/**
 * Клиентская сторона Service Worker (`public/sw.js`).
 *
 * Регистрация идёт только в собранном приложении: в режиме разработки воркер
 * кэширует то, что должно перезагружаться на каждое изменение, и отладка
 * превращается в угадывание, какая версия сейчас на экране.
 *
 * Обновление не применяется само. Новый воркер встаёт в очередь, приложение
 * предлагает перезагрузиться — потому что перезагрузить боевой экран посреди
 * выезда значит прервать РТП ради версии, которая подождёт до конца смены.
 */

/** Кэш данных ДЧС очищается при смене учётной записи: планшет в части общий. */
export function clearApiCache(): void {
  navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_API_CACHE" });
}

/** Есть ли обновление, ждущее перезагрузки. */
export type UpdateHandler = (apply: () => void) => void;

export function registerServiceWorker(onUpdate: UpdateHandler): () => void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return () => {};
  if (process.env.NODE_ENV !== "production") return () => {};

  let disposed = false;
  let reloading = false;

  const apply = (waiting: ServiceWorker) => () => {
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  const onControllerChange = () => {
    // Новый воркер взял управление — перезагружаемся ровно один раз.
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then((reg) => {
      if (disposed) return;
      if (reg.waiting) onUpdate(apply(reg.waiting));
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          // `controller` пуст при самой первой установке — это не обновление,
          // а первый запуск, и предлагать перезагрузку там незачем.
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            onUpdate(apply(installing));
          }
        });
      });
    })
    .catch(() => {
      // Воркер не встал (приватный режим, политика браузера) — приложение
      // работает как раньше: очереди в localStorage от него не зависят.
    });

  return () => {
    disposed = true;
    navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  };
}

/** Время снимка, если ответ пришёл из кэша воркера; null — ответ живой.
 *  Пустая строка — снимок без отметки времени (кэш прошлой версии). */
export function cachedAtOf(response: Response): string | null {
  return response.headers.has("X-FW-Cached")
    ? response.headers.get("X-FW-Cached") || ""
    : null;
}
