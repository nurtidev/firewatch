/**
 * Сопоставление этажей ПТП с реальной калиброванной геометрией планов
 * (web/src/data/floorplans/hayvill.ts) и мелкие чистые геометрические хелперы.
 *
 * Логика вынесена из JSX намеренно: это pure-функции без React/three-зависимостей,
 * их удобно покрывать юнит-тестами (вход — строка-метка этажа, выход — план или null).
 *
 * ВАЖНО (см. шапку hayvill.ts): три уровня паркинга калиброваны с разными масштабами,
 * их футпринты между собой НЕ совпадают. Здесь мы лишь выбираем план по метке этажа;
 * центрирование/укладку в стек делает 3D-компонент, честно НЕ выравнивая их по контуру.
 */

import { HAYVILL_FLOORPLANS, type RealFloorPlan } from "@/data/floorplans/hayvill";

const byId = (id: string): RealFloorPlan | null =>
  HAYVILL_FLOORPLANS.find((p) => p.id === id) ?? null;

/** Только для объектов, у которых есть оцифрованная реальная геометрия (пока — Хайвилл). */
export function isRealGeomObject(name?: string): boolean {
  return !!name && /хайвилл|hayvill|highvill/i.test(name);
}

/**
 * Метка этажа из ПТП → реальный план. Возвращает null, когда для этажа нет
 * реальной геометрии (тогда UI показывает схематическую раскладку / простую плиту).
 *
 * Сопоставление (совпадает с scaleNote в hayvill.ts):
 *  - «Цокольный этаж — 1-й уровень» → parking-l1
 *  - «Цокольный этаж — 2-й уровень» → parking-l2
 *  - «Паркинг (цокольный этаж)»      → parking-l3
 *  - «N-й этаж» (жилые)              → typical (общий типовой план)
 *  - «Технический этаж» и прочее     → null
 */
export function planForFloorLabel(label?: string): RealFloorPlan | null {
  if (!label) return null;
  const s = label.toLowerCase();

  // Технический этаж — отдельного плана нет.
  if (/техническ/.test(s)) return null;

  // Цокольные уровни / паркинг.
  if (/цоколь|цокольн|паркинг/.test(s)) {
    if (/2\s*-?\s*й?\s*уровень/.test(s)) return byId("parking-l2");
    if (/1\s*-?\s*й?\s*уровень/.test(s)) return byId("parking-l1");
    return byId("parking-l3"); // «Паркинг (цокольный этаж)» без номера уровня
  }

  // Жилые нумерованные этажи → общий типовой план.
  if (/\d+\s*-?\s*й?\s*этаж/.test(s) || /жил/.test(s)) return byId("typical");

  return null;
}

/** Гейтед-версия: план только если объект поддерживает реальную геометрию. */
export function realPlanForFloor(
  objectName: string | undefined,
  label: string | undefined,
): RealFloorPlan | null {
  if (!isRealGeomObject(objectName)) return null;
  return planForFloorLabel(label);
}

/** Планировки квартир объекта (для компактной галереи). */
export function apartmentPlans(objectName?: string): RealFloorPlan[] {
  if (!isRealGeomObject(objectName)) return [];
  return HAYVILL_FLOORPLANS.filter((p) => p.kind === "apartment");
}

/** Суммарная площадь помещений плана (для подписи «итого, м²»). */
export function planTotalArea(plan: RealFloorPlan): number {
  return Math.round(plan.rooms.reduce((s, r) => s + r.area_m2, 0));
}

/**
 * Центр bbox плана в план-координатах (метры). 3D-компонент вычитает его,
 * чтобы центрировать футпринт на оси стека (см. предупреждение о несовпадении
 * паркингов — выравниваем по центру, не по обмеру).
 */
export function planCenter(plan: RealFloorPlan): { cx: number; cy: number } {
  return { cx: plan.widthM / 2, cy: plan.heightM / 2 };
}
