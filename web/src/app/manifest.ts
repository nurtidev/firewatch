import type { MetadataRoute } from "next";

/**
 * PWA-манифест: делает FireWatch устанавливаемым на домашний экран.
 *
 * Главный пользователь мобильной установки — инспектор ГПК: он весь день в
 * поле, и очередь визитов с донесениями (lib/offline.ts) написана именно под
 * него. Установленное приложение запускается без браузерной строки и работает
 * при пропавшей связи — на объекте это норма, а не исключение.
 *
 * Нативного приложения нет намеренно: всё, что оно дало бы сверх этого, —
 * push и фоновая геолокация, а они в требованиях пока не звучали. Зато PWA
 * ставится по QR-коду за минуту и на любой телефон, без магазина и TestFlight.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FireWatch — предиктивная пожарная безопасность",
    short_name: "FireWatch",
    description:
      "Оценка риска зданий, планы тушения, инспекции и боевые выезды — МЧС РК",
    // Со стартового экрана роль сама уходит в свой раздел (DEFAULT_ROUTE),
    // поэтому фиксировать здесь маршрут инспектора нельзя: приложение общее.
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0a0a0b",
    theme_color: "#0a0a0b",
    lang: "ru",
    categories: ["government", "productivity", "utilities"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
      { src: "/apple-icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
