/* eslint-disable no-restricted-globals */
/**
 * Service Worker FireWatch — офлайн-оболочка для поля.
 *
 * Установка на домашний экран уже работала, но без воркера «приложение»
 * оставалось вкладкой: стоило потерять связь и перезагрузить страницу — и
 * инспектор в подвале получал экран динозавра. Очереди визитов, донесений и
 * расстановки при этом честно лежали в localStorage и ждали связи, которую
 * некому было дождаться, потому что открыть приложение уже нельзя.
 *
 * Стратегии выбраны по тому, чем грозит устаревание, а не по моде:
 *
 *   • **Навигации — сеть, потом кэш.** Свежая оболочка важнее мгновенной:
 *     версия приложения на боевом планшете должна совпадать с сервером.
 *     Таймаут 4 с — на 4G в подвале «связь есть, но не отвечает» встречается
 *     чаще, чем честный офлайн, и ждать ответа тридцать секунд нельзя.
 *   • **Статика Next (`_next/static`) — кэш, потом сеть.** Имена файлов
 *     содержат хэш сборки: содержимое по такому URL не меняется никогда, и
 *     ходить за ним в сеть — терять секунды на каждом запуске.
 *   • **API — сеть, потом кэш, и только GET из белого списка.** Боевой пакет,
 *     маршрут инспектора и карточка ПТП нужны в поле; всё остальное (журнал
 *     аудита, ИИ-аналитик, фотодоказательства) не кэшируется вовсе.
 *     Изменяющие запросы не кэшируются никогда — за доставку отвечают
 *     очереди в приложении, у которых есть идемпотентность и разбор отказов.
 *
 * **Ответ из кэша помечается.** К нему добавляется заголовок `X-FW-Cached`
 * с временем записи, и приложение показывает «снимок от 14:32». Молча отдать
 * старый боевой пакет как свежий — худшее, что здесь можно сделать: по нему
 * распоряжаются силами.
 *
 * **Обновление не применяется само.** Новый воркер ждёт, приложение
 * предлагает обновиться. Перезагрузить боевой экран посреди работы — значит
 * прервать РТП на пожаре ради версии, которая подождёт.
 */

const VERSION = "v1";
const SHELL_CACHE = `fw-shell-${VERSION}`;
const API_CACHE = `fw-api-${VERSION}`;
const OFFLINE_URL = "/offline.html";

/** Сколько ждём сеть, прежде чем отдать сохранённое. */
const NETWORK_TIMEOUT_MS = 4000;

/**
 * Пути API, которые нужны в поле. Всё, чего здесь нет, идёт мимо кэша —
 * список расширяется осознанно, а не «на всякий случай»: каждый лишний путь
 * это данные ДЧС, которые остаются на устройстве после смены.
 */
const API_CACHEABLE = [
  /^\/dispatch(\?|$)/, // список активных выездов
  /^\/dispatch\/\d+\/pack$/, // боевой пакет
  /^\/dispatch\/\d+\/deployment$/, // расстановка сил
  /^\/routes(\/|\?|$)/, // маршрут инспектора и чек-лист
  /^\/cards\/\d+$/, // карточка ПТП (поэтажные планы)
  /^\/vehicles(\/|\?|$)/, // техника части
];

/** Никогда не кэшируем: доказательства с ПДн и потоковые ответы. */
const API_NEVER = [/\/photo/, /^\/auth/, /^\/audit/, /^\/chat/, /^\/model/];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll([OFFLINE_URL])),
  );
  // Ждать активации не нужно: воркер всё равно не станет управляющим, пока
  // приложение само не попросит (см. SKIP_WAITING).
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("fw-") && k !== SHELL_CACHE && k !== API_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const type = event.data?.type;
  if (type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (type === "CLEAR_API_CACHE") {
    // Выход из учётной записи: данные ДЧС не должны пережить смену на общем
    // планшете части.
    event.waitUntil(caches.delete(API_CACHE));
  }
});

/* ───────────────────────────── Помощники ───────────────────────────── */

function isApiCacheable(url) {
  const path = url.pathname + url.search;
  if (API_NEVER.some((re) => re.test(url.pathname))) return false;
  return API_CACHEABLE.some((re) => re.test(path));
}

/** Копия ответа с отметкой «это сохранённая копия и вот когда она снята». */
async function withCachedMark(response) {
  const stamped = response.headers.get("x-fw-cached-at");
  const headers = new Headers(response.headers);
  headers.set("X-FW-Cached", stamped ?? "");
  headers.set("X-FW-Source", "sw-cache");
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Потолок записей в кэше. Имя кэша содержит версию воркера, а он меняется
 * редко — обычный деплой приносит новые хэшированные чанки в тот же кэш, и
 * без ограничения планшет через год работы хранил бы все сборки за год.
 * Числа взяты с запасом на одну сборку приложения плюс рабочий набор данных.
 */
const CACHE_LIMITS = { [SHELL_CACHE]: 150, [API_CACHE]: 60 };

/** Вытесняем самые старые записи: Cache API отдаёт ключи в порядке вставки. */
async function trim(cacheName) {
  const max = CACHE_LIMITS[cacheName];
  if (!max) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
}

/** Кладём в кэш вместе со временем записи — иначе «снимок от» неоткуда взять. */
async function putStamped(cacheName, request, response) {
  const headers = new Headers(response.headers);
  headers.set("x-fw-cached-at", new Date().toISOString());
  const copy = new Response(await response.clone().blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  const cache = await caches.open(cacheName);
  await cache.put(request, copy);
  await trim(cacheName);
}

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

/* ───────────────────────────── Маршрутизация ───────────────────────────── */

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Изменяющие запросы не трогаем: за их доставку отвечают очереди
  // приложения, где есть идемпотентность и показ отвергнутого.
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.origin === self.location.origin) {
    // Статика сборки: содержимое по URL с хэшем не меняется.
    if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg") {
      event.respondWith(cacheFirst(request, SHELL_CACHE));
      return;
    }
    // Переходы внутри приложения идут не навигацией, а запросом RSC-пейлоада
    // (`?_rsc=…`). Без него офлайн открывался бы только тот экран, который
    // успели загрузить: с боевого пакета нельзя было бы уйти в карточку.
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  // Cross-origin — это API (web и api живут на разных доменах).
  if (isApiCacheable(url)) {
    event.respondWith(apiNetworkFirst(request));
  }
});

async function handleNavigation(request) {
  try {
    const fresh = await Promise.race([fetch(request), timeout(NETWORK_TIMEOUT_MS)]);
    if (fresh && fresh.ok) {
      await putStamped(SHELL_CACHE, request, fresh);
    }
    return fresh;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Ни сети, ни снимка этой страницы — честная заглушка вместо экрана
    // браузерной ошибки: она объясняет, что очереди сохранены.
    const offline = await caches.match(OFFLINE_URL);
    return (
      offline ??
      new Response("Офлайн", { status: 503, headers: { "Content-Type": "text/plain" } })
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(request, fresh.clone());
    await trim(cacheName);
  }
  return fresh;
}

/** Отдаём сохранённое сразу и обновляем в фоне: так переходы внутри
 *  приложения не ждут сети, а следующий запуск получает свежее. */
async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then(async (fresh) => {
      if (fresh.ok) await putStamped(cacheName, request, fresh);
      return fresh;
    })
    .catch(() => null);
  if (cached) return cached;
  const fresh = await network;
  if (fresh) return fresh;
  const offline = await caches.match(OFFLINE_URL);
  return (
    offline ?? new Response("Офлайн", { status: 503, headers: { "Content-Type": "text/plain" } })
  );
}

async function apiNetworkFirst(request) {
  try {
    // `no-store` обязателен, и вот почему. Без него браузер при пропавшей
    // связи молча отдаёт свою HTTP-копию ответа, минуя наш кэш: запрос
    // «успешен», данные старые, а пометки «снимок от 14:32» нет — то есть
    // боевой пакет часовой давности выглядит живым. Нам нужно ровно
    // обратное: сеть либо отвечает, либо честно падает, и тогда снимок
    // отдаём мы сами — с отметкой времени.
    const fresh = await Promise.race([
      fetch(request, { cache: "no-store" }),
      timeout(NETWORK_TIMEOUT_MS),
    ]);
    // 401/403 не кэшируем: иначе протухший токен закрепил бы отказ на устройстве.
    if (fresh && fresh.ok) {
      await putStamped(API_CACHE, request, fresh);
    }
    return fresh;
  } catch {
    const cached = await caches.match(request);
    if (cached) return withCachedMark(cached);
    throw new Error("offline and not cached");
  }
}
