"use client";

import dynamic from "next/dynamic";
import {
  ArrowRight,
  Building2,
  FileWarning,
  Radar,
  ShieldCheck,
  EyeOff,
  Lock,
  BarChart3,
  FileCheck,
  type LucideIcon,
} from "lucide-react";
import { HAYVILL_FLOORPLANS, type RealFloorPlan } from "@/data/floorplans/hayvill";
import {
  LandingHeader,
  LandingFooter,
  PrimaryButton,
  GhostButton,
  HeroStat,
  Section,
  SectionHead,
  Hero3DSkeleton,
  MAILTO,
  type NavLink,
} from "@/components/landing/chrome";
import { MODULES } from "@/components/landing/content";
import RiskCityMap from "@/components/landing/RiskCityMap";

const LandingHero3D = dynamic(() => import("@/components/LandingHero3D"), {
  ssr: false,
  loading: () => <Hero3DSkeleton plan={HERO_PLAN} />,
});

const plan = (id: string): RealFloorPlan =>
  HAYVILL_FLOORPLANS.find((p) => p.id === id) ?? HAYVILL_FLOORPLANS[0];
const HERO_PLAN = plan("typical");

/* ── Content ─────────────────────────────────────────────────────────────── */

const NAV_LINKS: NavLink[] = [
  { href: "#modules", label: "Платформа" },
  { href: "#pilot", label: "Пилот" },
  { href: "#trust", label: "Безопасность" },
  { href: "/business", label: "Для бизнеса" },
];

const PROBLEMS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Building2,
    title: "250 000 зданий — вручную не приоритизировать",
    text: "Инспекторов — сотни, объектов — сотни тысяч. Решать, кого проверять первым, по интуиции и жалобам — значит опаздывать.",
  },
  {
    icon: FileWarning,
    title: "Планы тушения — в бумаге и .vsd",
    text: "ПТП и оперкарточки годами лежат в сканах и файлах Visio. Подготовка карточки на объект занимает у инженера дни.",
  },
  {
    icon: Radar,
    title: "Нет единой картины риска и «слепых зон»",
    text: "Где расчёт не успевает за норматив прибытия и где скопился риск — вручную по всему городу не увидеть.",
  },
];

const PILOT: { week: string; title: string; text: string }[] = [
  {
    week: "Неделя 0",
    title: "LOI и передача данных",
    text: "Подписание письма о намерениях, доступ к исторической статистике пожаров и реестру объектов района.",
  },
  {
    week: "Недели 1–2",
    title: "Карта риска района",
    text: "Загрузка данных и переобучение модели — карта риска на реальной статистике района, а не на демо.",
  },
  {
    week: "Недели 3–4",
    title: "Оцифровка объектов",
    text: "10–20 ключевых объектов района: ПТП и оперкарточки с 2D/3D-планами в системе.",
  },
  {
    week: "Недели 5–12",
    title: "Эксплуатация и отчёт",
    text: "Маршруты инспекций и чек-листы в работе, анализ «слепых зон» и отчёт об эффекте пилота.",
  },
];

const TRUST: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: ShieldCheck,
    title: "Журнал аудита (WORM)",
    text: "Каждое действие пользователя фиксируется в неизменяемом журнале — записи нельзя изменить или удалить задним числом.",
  },
  {
    icon: EyeOff,
    title: "Маскирование ПДн",
    text: "Персональные данные маскируются уже при извлечении из документов — в систему не попадает лишнее.",
  },
  {
    icon: Lock,
    title: "Данные в РК",
    text: "Хранение и обработка на инфраструктуре в Казахстане, доступ разграничен по ролям и районам.",
  },
  {
    icon: BarChart3,
    title: "Объяснимая модель (SHAP)",
    text: "Модель — не «чёрный ящик»: по каждой оценке виден вклад каждого фактора, решение можно обосновать.",
  },
  {
    icon: FileCheck,
    title: "Работа по форме МЧС РК",
    text: "Оцифровка оперкарточек по форме ОК-1 и планов тушения (ПТП/КТП) — в ведомственных форматах.",
  },
];

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function GovLanding() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <LandingHeader navLinks={NAV_LINKS} cta={{ label: "Запросить пилот", href: MAILTO.pilot }} />

      {/* ── Hero ── */}
      <section className="relative overflow-hidden px-5 pb-14 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
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
                МЧС РК
              </span>
              Ведомственная платформа · пилот в Астане
            </span>
            <h1 className="mt-5 text-[clamp(2.15rem,5vw,3.6rem)] font-extrabold leading-[1.05] tracking-tight">
              Прогноз пожарного риска{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg,var(--color-fg) 45%,var(--color-accent) 120%)",
                }}
              >
                для всего города
              </span>
            </h1>
            <p className="mt-5 max-w-[550px] text-[clamp(1rem,2vw,1.2rem)] leading-relaxed text-muted">
              FireWatch оценивает риск каждого из ~250 000 зданий, объясняет каждую оценку и
              превращает прогноз в маршруты инспекций и карту «слепых зон» прибытия расчётов —
              чтобы ДЧС действовал на опережение.
            </p>
            <div className="mt-8 flex flex-wrap gap-3.5">
              <a href={MAILTO.pilot}>
                <PrimaryButton className="px-6 py-3.5 text-[15px]">
                  Запросить пилот <ArrowRight className="h-4 w-4" />
                </PrimaryButton>
              </a>
              <GhostButton href={MAILTO.presentation}>Презентация платформы</GhostButton>
            </div>
            <div className="mt-9 flex flex-wrap gap-x-9 gap-y-5">
              <HeroStat n="~250 000" l="зданий города" />
              <HeroStat n="<10 мин" l="норматив прибытия" />
              <HeroStat n="SHAP" l="объяснимая модель" />
            </div>
          </div>

          {/* Stylised city risk map */}
          <div>
            <div className="relative h-[400px] overflow-hidden rounded-[20px] border border-border bg-surface shadow-pop sm:h-[460px] lg:h-[500px]">
              <RiskCityMap />
            </div>
            <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-faint">
              Стилизация карты риска на условных данных. Реальная карта строится на исторических
              данных пожаров вашего региона — каждое здание с оценкой 0–100.
            </p>
          </div>
        </div>
      </section>

      {/* ── Problems ── */}
      <div className="bg-surface-2">
        <Section id="problems">
          <SectionHead
            center
            eyebrow="Задача ведомства"
            title="Надзор за городом — вручную не масштабируется"
            sub="Объём объектов и разрозненные документы не дают увидеть риск целиком. FireWatch собирает эту картину в одном контуре."
          />
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {PROBLEMS.map((p) => (
              <div
                key={p.title}
                className="flex flex-col rounded-[16px] border border-border bg-surface p-6 shadow-card"
              >
                <span className="grid h-[46px] w-[46px] place-items-center rounded-xl border border-border bg-surface-2 text-fg">
                  <p.icon className="h-5 w-5" strokeWidth={1.9} />
                </span>
                <h3 className="mt-5 text-[17px] font-bold tracking-tight">{p.title}</h3>
                <p className="mt-2.5 text-[14px] leading-relaxed text-muted">{p.text}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* ── Modules ── */}
      <Section id="modules">
        <SectionHead
          center
          eyebrow="Платформа"
          title="Шесть модулей — один контур надзора"
          sub="Каждый модуль закрывает свою задачу ведомства и работает на общих данных ДЧС."
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

      {/* ── Pilot ── */}
      <div className="bg-surface-2">
        <Section id="pilot">
          <SectionHead
            center
            eyebrow="Пилот"
            title="Как проходит пилот"
            sub="3 месяца, 1 район Астаны. ДЧС получает рабочую систему на реальных данных района — и обоснованное решение о развёртывании на весь город."
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PILOT.map((s, i) => (
              <div
                key={s.week}
                className="relative flex flex-col rounded-[16px] border border-border bg-surface p-6 shadow-card"
              >
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-accent text-[13px] font-extrabold text-accent-fg tabular">
                    {i + 1}
                  </span>
                  <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-accent">
                    {s.week}
                  </span>
                </div>
                <h3 className="mt-4 text-[16px] font-bold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{s.text}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-[12.5px] text-faint">
            Что нужно от ДЧС: письмо о намерениях (LOI), история пожаров района за 2–3 года и
            реестр объектов, 1–2 контактных инспектора. Оцифровка до 20 объектов — в рамках пилота.
          </p>
        </Section>
      </div>

      {/* ── Trust / security (the differentiator) ── */}
      <Section id="trust">
        <SectionHead
          center
          eyebrow="Доверие и безопасность"
          title="Ведомственный контур — по умолчанию"
          sub="FireWatch спроектирован под требования госзаказчика: аудируемость, защита персональных данных, объяснимость и работа в форматах МЧС РК."
        />
        <div className="mt-12 grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
          {TRUST.map((t) => (
            <div key={t.title} className="rounded-[16px] border border-border bg-surface p-6 shadow-card">
              <span className="grid h-[42px] w-[42px] place-items-center rounded-xl border border-border bg-surface-2 text-accent">
                <t.icon className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <h3 className="mt-4 text-[16px] font-bold tracking-tight">{t.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">{t.text}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Digital twin (brief; full story on /) ── */}
      <div className="bg-surface-2">
        <Section id="twin">
          <div className="grid items-center gap-10 lg:grid-cols-[.9fr_1.1fr] lg:gap-16 [&>div]:min-w-0">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
                Цифровой двойник
              </span>
              <h2 className="mt-3.5 text-[clamp(1.55rem,3.4vw,2.3rem)] font-extrabold leading-tight tracking-tight">
                Бумажный ПТП — в интерактивный 3D
              </h2>
              <p className="mt-4 max-w-[480px] text-[16px] leading-relaxed text-muted">
                ИИ восстанавливает из сканов и .vsd реальную геометрию помещений: калиброванные
                полигоны с площадями в м², окрашенные по назначению. Тот же двойник — в оперкарточке
                объекта.
              </p>
              <div className="mt-7">
                <GhostButton href="/#twin">
                  Как устроена оцифровка <ArrowRight className="h-4 w-4" />
                </GhostButton>
              </div>
            </div>
            <div>
              <div className="relative h-[360px] overflow-hidden rounded-[20px] border border-border bg-surface shadow-pop sm:h-[420px]">
                <LandingHero3D className="h-full w-full" />
                <span className="pointer-events-none absolute right-3 top-3 rounded-[10px] border border-accent/30 bg-accent-weak px-2.5 py-1 text-[11px] font-semibold text-accent">
                  Реальная геометрия · 3D
                </span>
              </div>
              <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-faint">
                Типовой этаж ЖК «Хайвилл-Астана» из оперативного плана тушения — реальный объект
                города, уже оцифрованный в системе.
              </p>
            </div>
          </div>
        </Section>
      </div>

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
            Покажем на данных вашего региона
          </h2>
          <p className="relative mx-auto mt-4 max-w-[540px] text-[17px] text-muted">
            Пилот — 3 месяца на одном районе Астаны. Развернём систему на реальных данных района и
            покажем эффект в цифрах.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3.5">
            <a href={MAILTO.pilot}>
              <PrimaryButton className="px-6 py-3.5 text-[15px]">Запросить пилот</PrimaryButton>
            </a>
            <GhostButton href={MAILTO.presentation} className="bg-surface">
              Презентация платформы
            </GhostButton>
          </div>
          <p className="relative mt-5 text-[13px] text-faint">
            Без обязательств · на реальных данных района · с обучением сотрудников
          </p>
        </div>
      </section>

      <LandingFooter tagline="Ведомственная платформа пожарной безопасности · МЧС РК" />
    </div>
  );
}
