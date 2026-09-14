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
 *     Заглушка «нет связи» отдаётся только при ошибке сети: медленный, но
 *     живой первый запуск её не получает. Если сеть молчит дольше 10 с, а
 *     копия страницы уже есть, отдаётся копия — данные на ней всё равно
 *     приходят из API с пометкой «снимок от».
 *   • **Статика Next (`_next/static`) — кэш, потом сеть.** Имена файлов
 *     содержат хэш сборки: содержимое по такому URL не меняется никогда, и
 *     ходить за ним в сеть — терять секунды на каждом запуске.
 *   • **API — сеть, потом кэш, и только GET из белого списка.** Боевой пакет,
 *     маршрут инспектора и карточка ПТП нужны в поле; всё остальное (журнал
 *     аудита, ИИ-аналитик, фотодоказательства) не кэшируется вовсе. Здесь
 *     таймаут 4 с оставлен: на 4G в подвале «связь есть, но не отвечает»
 *     встречается чаще честного офлайна, а ответ из кэша помечен.
 *     Изменяющие запросы не кэшируются никогда — за доставку отвечают
 *     очереди в приложении, у которых есть идемпотентность и разбор отказов.
 *
 * **Кэши разделены по тому, что можно вытеснять.** Прекэш (заглушка) не
 * вытесняется никогда. Статика вытесняется по давности использования, а не
 * записи — чанк, на который ссылается сохранённая страница, используется при
 * каждом её открытии и в хвост очереди на вытеснение не попадает. Страницы и
 * данные API — отдельными потолками, чтобы они не выдавливали статику.
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

// v2: раздельные кэши (прекэш / статика / страницы / API). Смена версии
// сносит кэши v1 при активации, в том числе общий кэш, где заглушка
// вытеснялась первой.
const VERSION = "v2";
const PRECACHE = `fw-precache-${VERSION}`;
const STATIC_CACHE = `fw-static-${VERSION}`;
const PAGES_CACHE = `fw-pages-${VERSION}`;
const API_CACHE = `fw-api-${VERSION}`;
const CURRENT_CACHES = [PRECACHE, STATIC_CACHE, PAGES_CACHE, API_CACHE];
const API_CACHE_PREFIX = "fw-api-";
const OFFLINE_URL = "/offline.html";

/** Сколько API ждёт сеть, прежде чем отдать помеченный снимок. */
const API_TIMEOUT_MS = 4000;
/** Сколько навигация ждёт сеть, прежде чем отдать сохранённую копию страницы.
 *  Без копии навигация ждёт сеть до её ошибки. */
const NAV_CACHED_FALLBACK_MS = 10000;

/**
 * Пути API, которые нужны в поле. Всё, чего здесь нет, идёт мимо кэша —
 * список расширяется осознанно, а не «на всякий случай»: каждый лишний путь
 * это данные ДЧС, которые остаются на устройстве после смены.
 */
const API_CACHEABLE = [
  /^\/dispatch(\?|$)/, // список активных выездов
  /^\/dispatch\/\d+\/pack$/, // боевой пакет
  /^\/dispatch\/\d+\/deployment$/, // расстановка сил
  /^\/dispatch\/vehicles(\?|$)/, // техника частей
  /^\/routes(\/|\?|$)/, // маршрут инспектора и чек-лист
  /^\/cards\/\d+$/, // карточка ПТП (поэтажные планы)
];

/** Никогда не кэшируем: доказательства с ПДн и потоковые ответы. */
const API_NEVER = [/\/photo/, /^\/auth/, /^\/audit/, /^\/chat/, /^\/model/];

/**
 * Потолки записей. Прекэша здесь нет намеренно — он не вытесняется.
 * Статика: с запасом на две-три сборки приложения; страницы и API — рабочий
 * набор смены.
 */
const CACHE_LIMITS = { [STATIC_CACHE]: 400, [PAGES_CACHE]: 60, [API_CACHE]: 60 };

/**
 * Эпоха кэша API. Растёт при смене учётной записи: ответ, запрошенный до
 * очистки и пришедший после, принадлежит прошлому пользователю и в кэш не
 * пишется.
 */
let apiEpoch = 0;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PRECACHE).then((cache) => cache.addAll([OFFLINE_URL])));
  // Ждать активации не нужно: воркер всё равно не станет управляющим, пока
  // приложение само не попросит (см. SKIP_WAITING).
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("fw-") && !CURRENT_CACHES.includes(k))
          .map((k) => caches.delete(k)),
      );
      // Первая установка берёт открытую страницу под управление сразу — иначе
      // офлайн заработал бы только со второго запуска. Приложение отличает это
      // от обновления и не перезагружается (см. lib/sw.ts).
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const type = event.data?.type;
  if (type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (type === "CLEAR_API_CACHE") {
    // Смена учётной записи: данные ДЧС не должны пережить смену на общем
    // планшете части. Окно чистит Cache Storage и само (на случай, когда
    // воркер страницей не управляет); здесь важнее эпоха — см. apiEpoch.
    apiEpoch += 1;
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys.filter((k) => k.startsWith(API_CACHE_PREFIX)).map((k) => caches.delete(k)),
          ),
        ),
    );
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

/** Вытесняем самые старые записи: Cache API отдаёт ключи в порядке вставки,
 *  а перезапись переносит ключ в конец. */
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

async function offlineResponse() {
  const cache = await caches.open(PRECACHE);
  const offline = await cache.match(OFFLINE_URL);
  return (
    offline ??
    new Response("Офлайн", { status: 503, headers: { "Content-Type": "text/plain" } })
  );
}

async function matchPage(request) {
  const cache = await caches.open(PAGES_CACHE);
  return cache.match(request, { ignoreSearch: true });
}

/* ───────────────────────────── Маршрутизация ───────────────────────────── */

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Изменяющие запросы не трогаем: за их доставку отвечают очереди
  // приложения, где есть идемпотентность и показ отвергнутого.
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (url.origin === self.location.origin) {
    // Статика сборки: содержимое по URL с хэшем не меняется.
    if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg") {
      event.respondWith(cacheFirst(event, STATIC_CACHE));
      return;
    }
    // Переходы внутри приложения идут не навигацией, а запросом RSC-пейлоада
    // (`?_rsc=…`). Без него офлайн открывался бы только тот экран, который
    // успели загрузить: с боевого пакета нельзя было бы уйти в карточку.
    event.respondWith(staleWhileRevalidate(event, PAGES_CACHE));
    return;
  }

  // Cross-origin — это API (web и api живут на разных доменах).
  if (isApiCacheable(url)) {
    event.respondWith(apiNetworkFirst(request));
  }
});

async function handleNavigation(event) {
  const { request } = event;
  const network = fetch(request).then(async (fresh) => {
    if (fresh && fresh.ok) await putStamped(PAGES_CACHE, request, fresh);
    return fresh;
  });
  // Если человеку уже отдали копию, свежая страница всё равно должна лечь в
  // кэш — воркер не должен засыпать, не дописав её.
  event.waitUntil(network.catch(() => undefined));

  let timer;
  const slow = new Promise((resolve) => {
    timer = setTimeout(() => resolve("slow"), NAV_CACHED_FALLBACK_MS);
  });
  try {
    const first = await Promise.race([network, slow]);
    if (first !== "slow") return first;
    // Сеть медленная. Копия страницы есть — отдаём её. Нет — ждём сеть:
    // заглушка «нет связи» на медленном, но живом канале хуже ожидания.
    const cached = await matchPage(request);
    return cached ?? (await network);
  } catch {
    // Сеть ответила ошибкой — вот теперь честно офлайн.
    const cached = await matchPage(request);
    if (cached) return cached;
    return offlineResponse();
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(event, cacheName) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // Перезапись переносит используемый чанк в конец порядка вытеснения: при
    // обрезке уходят чанки прошлых сборок, а не те, на которые ссылается
    // открываемая страница.
    event.waitUntil(cache.put(request, cached.clone()).catch(() => undefined));
    return cached;
  }
  const fresh = await fetch(request);
  if (fresh.ok) {
    await cache.put(request, fresh.clone());
    await trim(cacheName);
  }
  return fresh;
}

/** Отдаём сохранённое сразу и обновляем в фоне: так переходы внутри
 *  приложения не ждут сети, а следующий запуск получает свежее. */
async function staleWhileRevalidate(event, cacheName) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (fresh) => {
      if (fresh.ok) await putStamped(cacheName, request, fresh);
      return fresh;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  return offlineResponse();
}

async function apiNetworkFirst(request) {
  const epoch = apiEpoch;
  let timer;
  try {
    // `no-store` обязателен, и вот почему. Без него браузер при пропавшей
    // связи молча отдаёт свою HTTP-копию ответа, минуя наш кэш: запрос
    // «успешен», данные старые, а пометки «снимок от 14:32» нет — то есть
    // боевой пакет часовой давности выглядит живым. Нам нужно ровно
    // обратное: сеть либо отвечает, либо честно падает, и тогда снимок
    // отдаём мы сами — с отметкой времени.
    const fresh = await Promise.race([
      fetch(request, { cache: "no-store" }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), API_TIMEOUT_MS);
      }),
    ]);
    // 401/403 не кэшируем: иначе протухший токен закрепил бы отказ на
    // устройстве. Ответ, начатый до смены учётной записи, — тоже.
    if (fresh && fresh.ok && epoch === apiEpoch) {
      await putStamped(API_CACHE, request, fresh);
    }
    return fresh;
  } catch {
    const cache = await caches.open(API_CACHE);
    const cached = await cache.match(request);
    if (cached) return withCachedMark(cached);
    throw new Error("offline and not cached");
  } finally {
    clearTimeout(timer);
  }
}
