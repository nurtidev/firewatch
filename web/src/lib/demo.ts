/**
 * Demo-data flag. The pilot currently runs on SYNTHESIZED building features
 * (alarms, wooden floors, nearby incidents are derived deterministically, not
 * measured). Every screen that shows a risk score or model metric must say so,
 * or a ДЧС reviewer will treat demo numbers as real and lose trust on the spot.
 *
 * Set NEXT_PUBLIC_DEMO_DATA=false once real ДЧС data is loaded to hide the
 * banners in one place.
 */
export const DEMO_DATA = process.env.NEXT_PUBLIC_DEMO_DATA !== "false";

/** Standard wording, reused across map / building card / model page. */
export const DEMO_NOTICE =
  "Демонстрационные данные. Риск-оценки рассчитаны на синтетических признаках " +
  "и не отражают реальное состояние объектов — до загрузки исторических данных ДЧС.";

export const DEMO_NOTICE_SHORT = "Демо-данные · синтетические признаки";
