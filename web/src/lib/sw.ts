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
 * Перезагрузка происходит только в той вкладке, где человек сам нажал
 * «Обновить»; остальные получают ненавязчивую подсказку.
 */

/** Кэш данных API в воркере: `fw-api` и кэши прошлых версий `fw-api-*`
 *  (см. public/sw.js). Стирать надо оба — перенос мог не состояться. */
const isApiCache = (name: string) => name === "fw-api" || name.startsWith("fw-api-");

/**
 * Стереть офлайн-кэш данных ДЧС — при входе и при выходе.
 *
 * Планшет в части общий, а кэш ключуется адресом запроса, а не токеном: без
 * очистки заступивший караул увидел бы маршрут и боевой пакет прошлой смены
 * как свои. Одного сообщения воркеру мало: после жёсткой перезагрузки
 * страница воркером не управляется, `controller` пуст, и сообщение уходит в
 * никуда. Cache Storage доступен окну напрямую — чистим отсюда; воркеру
 * сообщаем, чтобы он не дописал в кэш ответ, начатый до смены учётной записи.
 */
export async function clearApiCache(): Promise<void> {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_API_CACHE" });
  } catch {
    /* воркера нет — чистим сами */
  }
  if (typeof caches === "undefined") return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => isApiCache(k)).map((k) => caches.delete(k)));
  } catch {
    // Cache Storage недоступен (приватный режим, небезопасный контекст) —
    // значит, и кэша, который надо стирать, нет.
  }
}

export type SwUpdate =
  /** Новая версия скачана и ждёт. `apply` — применить и перезагрузить эту вкладку. */
  | { kind: "waiting"; apply: () => void }
  /** Новую версию уже применили в другой вкладке: код на этом экране старый,
   *  перезагрузиться — когда человеку удобно. */
  | { kind: "activated"; reload: () => void };

export function registerServiceWorker(onUpdate: (update: SwUpdate) => void): () => void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return () => {};
  if (process.env.NODE_ENV !== "production") return () => {};

  const sw = navigator.serviceWorker;
  let disposed = false;
  let reloading = false;
  // Какой воркер управлял страницей до события. null — при загрузке воркера
  // не было (первая установка или жёсткая перезагрузка): его clients.claim()
  // — не обновление, и перезагружать ради него нечего.
  let controller = sw.controller;
  // Обновление попросили именно в этой вкладке. Только тогда перезагрузка
  // уместна: человек нажал «Обновить» здесь и её ждёт.
  let requestedHere = false;

  const apply = (waiting: ServiceWorker) => () => {
    requestedHere = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  const reload = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };

  const onControllerChange = () => {
    const previous = controller;
    controller = sw.controller;
    if (previous == null) return; // первая установка взяла страницу — не обновление
    if (requestedHere) {
      reload();
      return;
    }
    // Обновление применили в другой вкладке. Перезагружать эту самовольно
    // нельзя: здесь может быть диспетчер посреди регистрации вызова.
    if (!disposed) onUpdate({ kind: "activated", reload });
  };

  sw.addEventListener("controllerchange", onControllerChange);

  sw.register("/sw.js", { scope: "/" })
    .then((reg) => {
      if (disposed) return;
      // Ждущий воркер при странице без управляющего (жёсткая перезагрузка)
      // не повод предлагать обновление: код на экране и так свежий.
      if (reg.waiting && sw.controller) onUpdate({ kind: "waiting", apply: apply(reg.waiting) });
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          // `controller` пуст при самой первой установке — это не обновление,
          // а первый запуск, и предлагать перезагрузку там незачем.
          if (installing.state === "installed" && sw.controller && !disposed) {
            onUpdate({ kind: "waiting", apply: apply(installing) });
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
    sw.removeEventListener("controllerchange", onControllerChange);
  };
}

/** Время снимка, если ответ пришёл из кэша воркера; null — ответ живой.
 *  Пустая строка — снимок без отметки времени (кэш прошлой версии). */
export function cachedAtOf(response: Response): string | null {
  return response.headers.has("X-FW-Cached")
    ? response.headers.get("X-FW-Cached") || ""
    : null;
}
