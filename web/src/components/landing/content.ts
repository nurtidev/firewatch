/* Content arrays reused across more than one landing surface. Page-specific copy
   stays in its page file; only genuinely shared data lives here so wording never
   drifts between "/", "/gov" and "/business". */

import {
  Map,
  Brain,
  ScanLine,
  Route,
  Droplets,
  Sparkles,
  Shapes,
  Box,
  Radio,
  Flame,
  Building2,
  type LucideIcon,
} from "lucide-react";

/** Paper ПТП / документ → vector polygons → interactive 3D twin. */
export const PIPELINE: { icon: LucideIcon; k: string; title: string; text: string }[] = [
  {
    icon: ScanLine,
    k: "01",
    title: "Бумажный ПТП или .vsd",
    text: "Отсканированный план тушения, чертёж Visio или PDF-экспликация — исходник, который сегодня лежит в папке.",
  },
  {
    icon: Shapes,
    k: "02",
    title: "Векторные полигоны",
    text: "Стены и помещения восстанавливаются в калиброванную геометрию: каждая комната — многоугольник с площадью в м².",
  },
  {
    icon: Box,
    k: "03",
    title: "Интерактивный 3D-двойник",
    text: "Помещения окрашены по назначению, кликабельны, вращаются. Тот самый двойник — в шапке главной страницы.",
  },
];

/** The full loop — prevention, oversight, response. Gov-framed, reused on "/" and "/gov".
    Keep in sync with the live product: modules 07–09 shipped after the first six. */
export const MODULES: {
  k: string;
  icon: LucideIcon;
  title: string;
  pain: string;
  text: string;
}[] = [
  {
    k: "01 · CORE",
    icon: Map,
    title: "Карта риска",
    pain: "Где загорится вероятнее всего?",
    text: "Каждое здание окрашено по оценке 0–100. Фильтры, клик → карточка с историей и SHAP-объяснением.",
  },
  {
    k: "02 · ML",
    icon: Brain,
    title: "Оценка и объяснение",
    pain: "Почему именно 87 из 100?",
    text: "XGBoost + SHAP: виден вклад каждого фактора. Ежедневный пересчёт по всему городу.",
  },
  {
    k: "03 · AI",
    icon: ScanLine,
    title: "Оперкарточки и ПТП",
    pain: "Час ручного ввода — в минуту",
    text: "Скан ОК-1 / ПТП → ИИ извлекает поля и строит 2D/3D-план → автопредписания из нарушений.",
  },
  {
    k: "04 · OPS",
    icon: Route,
    title: "План инспекций",
    pain: "Кого проверять сегодня?",
    text: "Маршрут на день по риску и сроку, мобильный чек-лист с фото, дашборд выполнения.",
  },
  {
    k: "05 · INFRA",
    icon: Droplets,
    title: "Инфраструктура",
    pain: "Куда не успеть за 10 минут?",
    text: "Гидранты, части, изохроны прибытия и автоподсветка «слепых зон» покрытия.",
  },
  {
    k: "06 · CHAT",
    icon: Sparkles,
    title: "ИИ-аналитик",
    pain: "Ответ без ручных выгрузок",
    text: "Вопрос на естественном языке → ответ строго из данных ДЧС, с указанием источников.",
  },
  {
    k: "07 · ЦОУ",
    icon: Radio,
    title: "Пульт диспетчера",
    pain: "Кого и чем направить на вызов?",
    text: "Регистрация вызова, наряд сил и техники, статусы подразделений и единая хронология выезда.",
  },
  {
    k: "08 · РТП",
    icon: Flame,
    title: "Боевой выезд",
    pain: "Что известно об объекте по дороге?",
    text: "Оперкарточка в руках у РТП, расстановка сил на поэтажном плане, расчёт сил и средств по методике ДЧС, печатная форма донесения о пожаре.",
  },
  {
    k: "09 · ПОРТАЛ",
    icon: Building2,
    title: "Кабинет собственника",
    pain: "Что устранить и до какого срока?",
    text: "Владелец объекта видит свои нарушения, сроки и документы — предписания не теряются в переписке.",
  },
];
