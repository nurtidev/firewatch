/**
 * Реальные схемы ДЧС по объектам — оцифрованы из исходных Visio (.vsd) ПТП.
 *
 * Источник: docs/docs_tg/*.vsd → vsd2xhtml (libvisio) → постранично → resvg → PNG.
 * Регенерация: web/scripts/build-schemes.mjs (см. комментарий в нём).
 *
 * Манифест статический и деплоится вместе с web — без обращения к API/БД.
 * Файлы лежат в web/public/schemes/<obj>/<group>/pNN.png и отдаются как /schemes/...
 */

export type SchemePage = {
  /** Путь от корня сайта, например /schemes/hayvill/deployment/p01.png */
  src: string;
  /** Подпись страницы для галереи и лайтбокса */
  title: string;
};

export type SchemeGroup = {
  id: string;
  /** Название раздела схем (как в исходном ПТП) */
  label: string;
  /** Имя исходного .vsd, из которого получены страницы */
  source: string;
  pages: SchemePage[];
};

export type ObjectSchemes = {
  /** Человекочитаемый объект, к которому относятся схемы */
  object: string;
  groups: SchemeGroup[];
};

/** Собрать массив страниц `pFROM..pTO` для группы. */
function pages(base: string, from: number, to: number, label: string): SchemePage[] {
  const out: SchemePage[] = [];
  for (let i = from; i <= to; i++) {
    const n = String(i).padStart(2, "0");
    out.push({ src: `${base}/p${n}.png`, title: `${label} · лист ${i}` });
  }
  return out;
}

export const OBJECT_SCHEMES: Record<string, ObjectSchemes> = {
  hayvill: {
    object: "ЖК «Хайвилл-Астана»",
    groups: [
      {
        id: "deployment",
        label: "Расстановка сил и средств",
        source: "Расстановка сил и средств.vsd",
        pages: [
          {
            src: "/schemes/hayvill/deployment/p01.png",
            title: "Расстановка сил и средств · 3 этаж",
          },
        ],
      },
      {
        id: "floors",
        label: "Поэтажные планы",
        source: "поэтажные планы.vsd",
        pages: pages("/schemes/hayvill/floors", 1, 11, "Поэтажный план"),
      },
      // NB: «схемы (1).vsd» — сборный файл ПЧ с несколькими объектами
      // (этажные схемы + СО «Евразия-2» + 6-МКР), поэтому не включён под Хайвилл.
    ],
  },
  alanda: {
    object: "ЖК «Аланда»",
    groups: [
      {
        id: "scheme",
        label: "Схемы объекта",
        source: "Жк Аланда схема.vsd",
        pages: pages("/schemes/alanda/scheme", 1, 19, "Схема"),
      },
    ],
  },
  evraziya: {
    object: "ТРЦ «Евразия-3»",
    groups: [
      {
        id: "scheme",
        label: "Схемы объекта",
        source: "Евразия-3 визио.vsd",
        pages: pages("/schemes/evraziya/scheme", 1, 6, "Схема"),
      },
    ],
  },
};

/** Подобрать схемы по названию объекта из ПТП (нечёткое сопоставление). */
export function schemesForObject(name?: string): ObjectSchemes | null {
  if (!name) return null;
  if (/хайвилл|hayvill|highvill/i.test(name)) return OBJECT_SCHEMES.hayvill;
  if (/аланда|alanda/i.test(name)) return OBJECT_SCHEMES.alanda;
  if (/евразия|evrazi/i.test(name)) return OBJECT_SCHEMES.evraziya;
  return null;
}

/** Всего страниц во всех группах. */
export function totalSchemePages(s: ObjectSchemes): number {
  return s.groups.reduce((n, g) => n + g.pages.length, 0);
}
