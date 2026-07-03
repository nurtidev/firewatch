"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Flame,
  ArrowRight,
  Menu,
  X,
  Map,
  Brain,
  ScanLine,
  Route,
  Droplets,
  Sparkles,
  Shapes,
  Box,
  Building2,
  Layers,
  ShieldCheck,
  BarChart3,
  FileCheck,
  Lock,
  Check,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { DEFAULT_ROUTE } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "@/components/ThemeToggle";
import { roomTypeMeta } from "@/lib/floorplan";
import { HAYVILL_FLOORPLANS, type RealFloorPlan } from "@/data/floorplans/hayvill";
import FloorPlan2D from "@/components/FloorPlan2D";

/* Three.js touches WebGL/window — load client-side only, behind a static-looking
   skeleton so first paint is never blocked. */
const LandingHero3D = dynamic(() => import("@/components/LandingHero3D"), {
  ssr: false,
  loading: () => <Hero3DSkeleton />,
});

/* ── Data helpers ────────────────────────────────────────────────────────── */

const plan = (id: string): RealFloorPlan =>
  HAYVILL_FLOORPLANS.find((p) => p.id === id) ?? HAYVILL_FLOORPLANS[0];

const HERO_PLAN = plan("typical");
const PIPELINE_PLAN = plan("apt-2k");

/* ── Content ─────────────────────────────────────────────────────────────── */

const PIPELINE: { icon: LucideIcon; k: string; title: string; text: string }[] = [
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
    text: "Помещения окрашены по назначению, кликабельны, вращаются. Тот самый двойник — в шапке этой страницы.",
  },
];

const MODULES: {
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
    title: "Прогноз и объяснение",
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
];

const STEPS: { title: string; text: string }[] = [
  {
    title: "Сбор данных",
    text: "Здания из OSM и кадастра, история инцидентов за 3 года, гидранты, пожарные части. Оперкарточки распознаёт ИИ — строго из документа, без выдумок.",
  },
  {
    title: "Прогноз риска",
    text: "Модель XGBoost оценивает каждое здание по 30+ признакам: материал, возраст, этажность, инциденты рядом, сезон. SHAP объясняет каждую оценку.",
  },
  {
    title: "Действие",
    text: "Утренний маршрут инспектора по приоритету риска, подсветка «слепых зон» прибытия, ответ ИИ-аналитика на запрос на естественном языке.",
  },
];

const STATS: { n: string; u?: string; l: string }[] = [
  { n: "4 505", l: "зданий на карте риска" },
  { n: "1 128", l: "гидрантов в модели покрытия" },
  { n: "3", l: "объекта с оцифрованными ПТП" },
  { n: "81", l: "помещение в 3D-двойниках" },
  { n: "8", l: "планов этажей оцифровано" },
];

const TRUST: { icon: LucideIcon; label: string }[] = [
  { icon: BarChart3, label: "Объяснимая модель (SHAP)" },
  { icon: FileCheck, label: "ИИ не выдумывает" },
  { icon: ShieldCheck, label: "Журнал аудита (WORM)" },
  { icon: Lock, label: "Данные в РК" },
];

const BUSINESS: string[] = [
  "Аудит пожарной безопасности и план эвакуации",
  "2D/3D-планы объекта — автогенерация из документов",
  "Цифровой паспорт: планы, карточки и риск-оценка в одном портале",
  "Предиктивная риск-оценка объекта — которой нет ни у кого в РК",
];

const NAV_LINKS = [
  { href: "#twin", label: "Цифровой двойник" },
  { href: "#modules", label: "Платформа" },
  { href: "#how", label: "Как работает" },
  { href: "#business", label: "Для бизнеса" },
];

const DEMO_MAILTO =
  "mailto:nurtilek.assankhan@gmail.com?subject=Запрос%20демо%20FireWatch";
const BUSINESS_MAILTO =
  "mailto:nurtilek.assankhan@gmail.com?subject=Оцифровка%20объекта%20—%20FireWatch";

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function Landing() {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const appHref = user ? DEFAULT_ROUTE[user.role] : "/login";
  const appLabel = user ? "Открыть платформу" : "Войти";

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* ── Header ── */}
      <header
        className={cn(
          "sticky top-0 z-50 backdrop-blur-xl transition-colors",
          scrolled
            ? "border-b border-border bg-bg/80"
            : "border-b border-transparent bg-bg/60",
        )}
      >
        <div className="mx-auto flex h-[66px] max-w-[1180px] items-center justify-between px-5 sm:px-6">
          <Brand />
          <nav className="hidden items-center gap-8 text-sm font-medium text-muted md:flex">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="transition-colors hover:text-fg">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2.5">
            <ThemeToggle className="h-10 w-10 rounded-[12px] border border-border-strong" />
            <Link
              href={appHref}
              className="hidden rounded-[12px] border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-fg shadow-card transition-colors hover:border-faint sm:inline-flex"
            >
              {appLabel}
            </Link>
            <a href={DEMO_MAILTO} className="hidden sm:inline-flex">
              <PrimaryButton>Запросить демо</PrimaryButton>
            </a>
            <button
              onClick={() => setMenu((v) => !v)}
              className="grid h-10 w-10 place-items-center rounded-[12px] border border-border-strong text-muted md:hidden"
              aria-label="Меню"
              aria-expanded={menu}
              aria-controls="mobile-nav"
            >
              {menu ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {/* Mobile menu */}
        {menu && (
          <div id="mobile-nav" className="border-t border-border bg-bg px-5 py-4 md:hidden">
            <nav className="flex flex-col gap-1">
              {NAV_LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setMenu(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
                >
                  {l.label}
                </a>
              ))}
              <Link
                href={appHref}
                className="mt-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-fg hover:bg-surface-2"
              >
                {appLabel}
              </Link>
              <a href={DEMO_MAILTO} className="mt-1">
                <PrimaryButton className="w-full justify-center">Запросить демо</PrimaryButton>
              </a>
            </nav>
          </div>
        )}
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden px-5 pb-14 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
        {/* single, restrained accent glow */}
        <div
          className="pointer-events-none absolute -right-32 -top-40 h-[520px] w-[520px] rounded-full opacity-70 blur-[90px]"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklab, var(--color-accent) 20%, transparent), transparent 70%)",
          }}
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-[1180px] items-center gap-12 lg:grid-cols-[1.02fr_.98fr] lg:gap-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-2 py-1.5 pr-3.5 text-[12.5px] font-semibold text-muted shadow-card">
              <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] text-accent-fg">
                Пилот
              </span>
              Астана · предиктивная пожарная безопасность
            </span>
            <h1 className="mt-5 text-[clamp(2.15rem,5vw,3.6rem)] font-extrabold leading-[1.05] tracking-tight">
              Цифровой двойник объекта{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg,var(--color-fg) 45%,var(--color-accent) 120%)",
                }}
              >
                и прогноз риска
              </span>{" "}
              — до того, как загорится
            </h1>
            <p className="mt-5 max-w-[540px] text-[clamp(1rem,2vw,1.2rem)] leading-relaxed text-muted">
              FireWatch превращает бумажный план тушения в интерактивный 3D-двойник, оценивает
              риск каждого здания и объясняет почему — чтобы ДЧС действовал на опережение, а не
              постфактум.
            </p>
            <div className="mt-8 flex flex-wrap gap-3.5">
              <a href={DEMO_MAILTO}>
                <PrimaryButton className="px-6 py-3.5 text-[15px]">
                  Запросить демо <ArrowRight className="h-4 w-4" />
                </PrimaryButton>
              </a>
              <a
                href="#twin"
                className="inline-flex items-center gap-2 rounded-[12px] border border-border-strong bg-surface px-6 py-3.5 text-[15px] font-semibold text-fg shadow-card transition-colors hover:border-faint"
              >
                Как это работает
              </a>
            </div>
            <div className="mt-9 flex flex-wrap gap-x-9 gap-y-5">
              <HeroStat n="0–100" l="оценка риска здания" />
              <HeroStat n="<10 мин" l="норматив прибытия" />
              <HeroStat n="SHAP" l="объяснимая модель" />
            </div>
          </div>

          {/* Live interactive 3D floor */}
          <div>
            <div className="relative h-[400px] overflow-hidden rounded-[20px] border border-border bg-surface shadow-pop sm:h-[460px] lg:h-[500px]">
              <LandingHero3D className="h-full w-full" />
              <span className="pointer-events-none absolute right-3 top-3 rounded-[10px] border border-accent/30 bg-accent-weak px-2.5 py-1 text-[11px] font-semibold text-accent">
                Реальная геометрия · 3D
              </span>
            </div>
            <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-faint">
              Реальная геометрия типового этажа ЖК «Хайвилл-Астана» из оперативного плана
              тушения. Вращайте, кликайте по помещениям.
            </p>
          </div>
        </div>
      </section>

      {/* ── Trust / numbers strip ── */}
      <Section id="numbers">
        <div className="rounded-[20px] border border-border bg-surface p-7 shadow-card sm:p-9">
          <div className="grid gap-8 sm:grid-cols-3 lg:grid-cols-5">
            {STATS.map((s) => (
              <div key={s.l}>
                <div className="text-[clamp(1.9rem,4vw,2.6rem)] font-extrabold leading-none tracking-tight">
                  <span className="tabular">{s.n}</span>
                  {s.u && <span className="text-accent">{s.u}</span>}
                </div>
                <div className="mt-2.5 text-[13px] leading-snug text-muted">{s.l}</div>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-border pt-6">
            {TRUST.map((t) => (
              <span key={t.label} className="inline-flex items-center gap-2 text-[13px] text-muted">
                <t.icon className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden />
                {t.label}
              </span>
            ))}
          </div>
          <p className="mt-5 text-[12px] leading-relaxed text-faint">
            Данные пилота (Астана). Риск-оценки рассчитаны на синтетических признаках и не отражают
            реальное состояние объектов — до загрузки исторических данных ДЧС.
          </p>
        </div>
      </Section>

      {/* ── Paper ПТП → digital 3D twin (the differentiator) ── */}
      <div className="bg-surface-2">
        <Section id="twin">
          <SectionHead
            center
            eyebrow="Оцифровка"
            title="Из бумажного ПТП — в цифровой 3D-двойник"
            sub="Планы тушения годами лежат в .vsd и сканах. Мы восстанавливаем из них реальную геометрию помещений — и она сразу становится интерактивной."
          />
          <div className="mt-14 grid items-stretch gap-5 md:grid-cols-3">
            {PIPELINE.map((p, i) => (
              <div key={p.k} className="relative flex flex-col">
                {i < PIPELINE.length - 1 && (
                  <span
                    className="absolute right-[-14px] top-[86px] z-10 hidden h-6 w-6 place-items-center rounded-full border border-border bg-surface text-muted md:grid"
                    aria-hidden
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                )}
                <div className="flex h-full flex-col rounded-[16px] border border-border bg-surface p-4 shadow-card">
                  <div className="relative aspect-[3/2] overflow-hidden rounded-[11px] border border-border bg-surface-2">
                    {i === 2 ? (
                      <div className="absolute inset-0 grid place-items-center p-3">
                        <FloorPlan2D plan={PIPELINE_PLAN} compact className="w-full" />
                      </div>
                    ) : (
                      <div className="absolute inset-0 p-3">
                        <MiniPlan plan={PIPELINE_PLAN} mode={i === 0 ? "scan" : "vector"} />
                      </div>
                    )}
                    {i === 0 && (
                      <div
                        className="pointer-events-none absolute inset-0 opacity-[0.5]"
                        style={{
                          backgroundImage:
                            "repeating-linear-gradient(0deg, color-mix(in oklab, var(--color-faint) 22%, transparent) 0 1px, transparent 1px 4px)",
                        }}
                        aria-hidden
                      />
                    )}
                  </div>
                  <div className="mt-4 flex items-center gap-2.5">
                    <span className="grid h-9 w-9 place-items-center rounded-[10px] border border-border bg-surface-2 text-fg">
                      <p.icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
                    </span>
                    <span className="text-[12px] font-bold tracking-[0.12em] text-accent">
                      {p.k}
                    </span>
                  </div>
                  <h3 className="mt-3 text-[16.5px] font-bold tracking-tight">{p.title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted">{p.text}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-[12.5px] text-faint">
            На примере поквартирной экспликации ЖК «Хайвилл-Астана». Полигоны калиброваны по
            площадям из ПТП — это оцифровка реального документа, а не иллюстрация.
          </p>
        </Section>
      </div>

      {/* ── Modules ── */}
      <Section id="modules">
        <SectionHead
          center
          eyebrow="Платформа"
          title="Шесть модулей — один контур безопасности"
          sub="Каждый закрывает свою боль ведомства и работает с общими данными."
        />
        <div className="mt-12 grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <div
              key={m.k}
              className="group rounded-[16px] border border-border bg-surface p-6 shadow-card transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-pop"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-[42px] w-[42px] place-items-center rounded-xl border border-border bg-surface-2 text-fg transition-colors group-hover:border-border-strong">
                  <m.icon className="h-5 w-5" strokeWidth={1.9} />
                </span>
                <span className="text-[11px] font-bold tracking-[0.1em] text-faint">{m.k}</span>
              </div>
              <h3 className="mt-4 text-[16.5px] font-bold tracking-tight">{m.title}</h3>
              <p className="mt-2.5 text-[12.5px] font-semibold text-accent">{m.pain}</p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{m.text}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── How it works ── */}
      <div className="bg-surface-2">
        <Section id="how">
          <SectionHead
            center
            eyebrow="Как работает"
            title="От данных — к действию за три шага"
            sub="FireWatch собирает данные, прогнозирует риск и превращает прогноз в конкретные задачи для инспекторов."
          />
          <div className="mt-[52px] grid gap-6 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="relative pt-5">
                {i < STEPS.length - 1 && (
                  <span className="absolute left-10 top-[26px] hidden h-0.5 w-full bg-gradient-to-r from-border-strong to-transparent sm:block" />
                )}
                <span className="text-[13px] font-extrabold tracking-wider text-accent">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-3.5 text-[19px] font-bold tracking-tight">{s.title}</h3>
                <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">{s.text}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* ── For business objects ── */}
      <Section id="business">
        <div className="grid items-center gap-10 rounded-[24px] border border-border bg-surface p-7 shadow-card lg:grid-cols-[1.1fr_.9fr] lg:p-11">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
              Для объектов бизнеса
            </span>
            <h2 className="mt-3.5 text-[clamp(1.55rem,3.4vw,2.3rem)] font-extrabold leading-tight tracking-tight">
              Цифровой паспорт объекта — ТРЦ, ЖК и офисам
            </h2>
            <p className="mt-4 max-w-[520px] text-[16px] leading-relaxed text-muted">
              Не просто пакет документов, а объект с ИИ-извлечением, 2D/3D-планами и предиктивной
              риск-картой. Конкуренты в РК делают то же вручную и без аналитики — мы быстрее и
              нагляднее.
            </p>
            <ul className="mt-6 space-y-2.5">
              {BUSINESS.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-[14.5px] text-fg">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-weak text-accent">
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                  </span>
                  {b}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a href={BUSINESS_MAILTO}>
                <PrimaryButton className="px-6 py-3.5 text-[15px]">
                  Обсудить оцифровку объекта <ArrowRight className="h-4 w-4" />
                </PrimaryButton>
              </a>
              <span className="text-[13px] text-muted">
                Пакет от <span className="font-semibold tabular text-fg">150 000 ₸</span> за объект ·
                мониторинг от <span className="tabular">30 000 ₸</span>/мес
              </span>
            </div>
          </div>

          {/* real apartment plan as the visual */}
          <div className="rounded-[18px] border border-border bg-surface-2 p-4">
            <div className="mb-3 flex items-center gap-2 text-[12px] font-medium text-muted">
              <Building2 className="h-4 w-4 text-accent" aria-hidden />
              Цифровой паспорт · план помещения
            </div>
            <FloorPlan2D plan={plan("apt-4k")} compact className="w-full" />
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-faint">
              <span className="inline-flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" aria-hidden /> 2D / 3D-планы
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Аудит ПБ
              </span>
              <span className="inline-flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" aria-hidden /> Риск-оценка
              </span>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Final CTA ── */}
      <section className="px-5 pb-24 sm:px-6">
        <div className="relative mx-auto max-w-[1180px] overflow-hidden rounded-[28px] border border-border bg-surface px-6 py-16 text-center shadow-card sm:px-12">
          <div
            className="pointer-events-none absolute -top-28 left-1/2 h-[320px] w-[620px] -translate-x-1/2 opacity-80 blur-[70px]"
            style={{
              background:
                "radial-gradient(ellipse, color-mix(in oklab, var(--color-accent) 22%, transparent), transparent 70%)",
            }}
            aria-hidden
          />
          <h2 className="relative text-[clamp(1.6rem,3.6vw,2.4rem)] font-extrabold leading-tight tracking-tight">
            Покажем FireWatch на данных вашего региона
          </h2>
          <p className="relative mx-auto mt-4 max-w-[520px] text-[17px] text-muted">
            Демо за 30 минут: карта риска, прогноз модели, маршрут инспектора и 3D-двойник объекта
            на реальном городе.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3.5">
            <a href={DEMO_MAILTO}>
              <PrimaryButton className="px-6 py-3.5 text-[15px]">Запросить демо</PrimaryButton>
            </a>
            <Link
              href={appHref}
              className="inline-flex items-center gap-2 rounded-[12px] border border-border-strong bg-surface px-6 py-3.5 text-[15px] font-semibold text-fg transition-colors hover:border-faint"
            >
              {appLabel}
            </Link>
          </div>
          <p className="relative mt-5 text-[13px] text-faint">
            Без обязательств · 30 минут · на данных вашего региона
          </p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border px-5 py-11 text-[13.5px] text-muted sm:px-6">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-5">
          <Brand small />
          <div>Предиктивная пожарная безопасность · ДЧС РК · Астана</div>
          <div>© 2026 FireWatch</div>
        </div>
      </footer>
    </div>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

function Brand({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 font-extrabold tracking-tight">
      <span
        className={cn(
          "grid place-items-center rounded-[9px] bg-gradient-to-br from-accent to-accent-hover text-white",
          small ? "h-[26px] w-[26px]" : "h-[30px] w-[30px]",
        )}
        style={{
          boxShadow:
            "0 6px 16px -4px color-mix(in oklab, var(--color-accent) 55%, transparent)",
        }}
      >
        <Flame className={small ? "h-3.5 w-3.5" : "h-[17px] w-[17px]"} fill="currentColor" strokeWidth={0} />
      </span>
      <span className={small ? "text-base" : "text-lg"}>
        FireWatch<span className="text-accent">.</span>
      </span>
    </div>
  );
}

function PrimaryButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-[12px] bg-accent px-[18px] py-2.5 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover",
        className,
      )}
      style={{
        boxShadow: "0 8px 20px -6px color-mix(in oklab, var(--color-accent) 45%, transparent)",
      }}
    >
      {children}
    </span>
  );
}

function HeroStat({ n, l }: { n: string; l: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xl font-extrabold tracking-tight tabular">{n}</span>
      <span className="text-[12.5px] font-medium text-muted">{l}</span>
    </div>
  );
}

function Section({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="px-5 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-[1180px]">{children}</div>
    </section>
  );
}

function SectionHead({
  eyebrow,
  title,
  sub,
  center,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  center?: boolean;
}) {
  return (
    <div className={cn("max-w-[680px]", center && "mx-auto text-center")}>
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">{eyebrow}</span>
      <h2 className="mt-3.5 text-[clamp(1.6rem,3.6vw,2.5rem)] font-extrabold leading-tight tracking-tight">
        {title}
      </h2>
      <p className="mt-4 text-[17px] leading-relaxed text-muted">{sub}</p>
    </div>
  );
}

/**
 * Small SVG of a real calibrated plan for the pipeline steps.
 *  • scan   — monochrome zoning boxes (the "before": a flat document).
 *  • vector — polygon outlines in accent (the "vectorised" middle state).
 * Room-type colouring (the "after") is handled by <FloorPlan2D compact /> so the
 * single source of type colours (ROOM_TYPE_META) is never duplicated here.
 */
function MiniPlan({ plan, mode }: { plan: RealFloorPlan; mode: "scan" | "vector" }) {
  const pad = Math.max(plan.widthM, plan.heightM) * 0.03;
  const vbW = plan.widthM + pad * 2;
  const vbH = plan.heightM + pad * 2;
  const sw = Math.max(plan.widthM, plan.heightM) * 0.014;
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${vbW} ${vbH}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {plan.rooms.map((r, i) => {
        const pts = r.polygon.map((p) => p.join(",")).join(" ");
        return mode === "scan" ? (
          <polygon
            key={i}
            points={pts}
            fill="var(--color-surface-3)"
            stroke="var(--color-faint)"
            strokeOpacity={0.6}
            strokeWidth={sw}
            strokeLinejoin="round"
          />
        ) : (
          <polygon
            key={i}
            points={pts}
            fill="var(--color-accent)"
            fillOpacity={0.07}
            stroke="var(--color-accent)"
            strokeOpacity={0.85}
            strokeWidth={sw * 1.3}
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}

/** Static, plan-shaped skeleton shown while the 3D chunk loads. */
function Hero3DSkeleton() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "linear-gradient(color-mix(in oklab, var(--color-faint) 12%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklab, var(--color-faint) 12%, transparent) 1px, transparent 1px)",
          backgroundSize: "26px 26px, 26px 26px",
        }}
        aria-hidden
      />
      <div className="absolute inset-0 grid place-items-center p-10 opacity-70">
        <MiniPlan plan={HERO_PLAN} mode="vector" />
      </div>
      <div className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-[10px] border border-border bg-surface/80 px-2.5 py-1.5 text-[11.5px] text-muted backdrop-blur">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
        Загрузка 3D-двойника…
      </div>
    </div>
  );
}
