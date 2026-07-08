"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowRight,
  ShieldCheck,
  BarChart3,
  FileCheck,
  Lock,
  Landmark,
  Building2,
  type LucideIcon,
} from "lucide-react";
import { HAYVILL_FLOORPLANS, type RealFloorPlan } from "@/data/floorplans/hayvill";
import FloorPlan2D from "@/components/FloorPlan2D";
import {
  LandingHeader,
  LandingFooter,
  PrimaryButton,
  GhostButton,
  HeroStat,
  Section,
  SectionHead,
  MiniPlan,
  Hero3DSkeleton,
  MAILTO,
  type NavLink,
} from "@/components/landing/chrome";
import { PIPELINE, MODULES } from "@/components/landing/content";
import { Reveal, CountUp } from "@/components/landing/reveal";
import { useT } from "@/lib/i18n";

/* Three.js touches WebGL/window — load client-side only, behind a static-looking
   skeleton so first paint is never blocked. */
const LandingHero3D = dynamic(() => import("@/components/LandingHero3D"), {
  ssr: false,
  loading: () => <Hero3DSkeleton plan={HERO_PLAN} />,
});

/* ── Data helpers ────────────────────────────────────────────────────────── */

const plan = (id: string): RealFloorPlan =>
  HAYVILL_FLOORPLANS.find((p) => p.id === id) ?? HAYVILL_FLOORPLANS[0];

const HERO_PLAN = plan("typical");
const PIPELINE_PLAN = plan("apt-2k");

/* ── Page-local content ──────────────────────────────────────────────────── */

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

const STATS: { n: number; l: string }[] = [
  { n: 4505, l: "зданий на карте риска" },
  { n: 1128, l: "гидрантов в модели покрытия" },
  { n: 3, l: "объекта с оцифрованными ПТП" },
  { n: 81, l: "помещение в 3D-двойниках" },
  { n: 8, l: "планов этажей оцифровано" },
];

const TRUST: { icon: LucideIcon; label: string }[] = [
  { icon: BarChart3, label: "Объяснимая модель (SHAP)" },
  { icon: FileCheck, label: "ИИ не выдумывает" },
  { icon: ShieldCheck, label: "Журнал аудита (WORM)" },
  { icon: Lock, label: "Данные в РК" },
];

const FORK: {
  href: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  sub: string;
  bullets: string[];
  cta: string;
}[] = [
  {
    href: "/gov",
    icon: Landmark,
    eyebrow: "Государство",
    title: "Для ДЧС и акиматов",
    sub: "Ведомственная платформа предиктивной пожарной безопасности для города и региона.",
    bullets: [
      "Карта риска по всем зданиям города",
      "Журнал аудита, маскирование ПДн, данные в РК",
      "Пилот на реальных данных вашего региона",
    ],
    cta: "Платформа для ДЧС",
  },
  {
    href: "/business",
    icon: Building2,
    eyebrow: "Бизнес",
    title: "Для объектов бизнеса",
    sub: "Цифровой паспорт объекта для ТРЦ, ЖК, офисов и застройщиков — с ИИ и риск-картой.",
    bullets: [
      "Аудит ПБ, план эвакуации и 2D/3D-планы",
      "ИИ-извлечение из документов за минуты",
      "Предиктивная риск-оценка объекта",
    ],
    cta: "Оцифровать объект",
  },
];

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function Landing() {
  const t = useT();

  const navLinks: NavLink[] = [
    { href: "#twin", label: t("Цифровой двойник") },
    { href: "#modules", label: t("Платформа") },
    { href: "#how", label: t("Как работает") },
    { href: "/gov", label: t("Для ДЧС") },
    { href: "/business", label: t("Для бизнеса") },
  ];

  return (
    <div className="min-h-screen bg-bg text-fg">
      <LandingHeader navLinks={navLinks} cta={{ label: t("Запросить демо"), href: MAILTO.demo }} />

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
        <div className="relative mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-12 lg:grid-cols-[1.02fr_.98fr] lg:gap-16 [&>div]:min-w-0">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-2 py-1.5 pr-3.5 text-[12.5px] font-semibold text-muted shadow-card">
              <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] text-accent-fg">
                {t("Пилот")}
              </span>
              {t("Астана · предиктивная пожарная безопасность")}
            </span>
            <h1 className="mt-5 text-[clamp(2.15rem,5vw,3.6rem)] font-extrabold leading-[1.05] tracking-tight">
              {t("Цифровой двойник объекта")}{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg,var(--color-fg) 45%,var(--color-accent) 120%)",
                }}
              >
                {t("и прогноз риска")}
              </span>{" "}
              {t("— до того, как загорится")}
            </h1>
            <p className="mt-5 max-w-[540px] text-[clamp(1rem,2vw,1.2rem)] leading-relaxed text-muted">
              {t(
                "FireWatch превращает бумажный план тушения в интерактивный 3D-двойник, оценивает риск каждого здания и объясняет почему — чтобы ДЧС действовал на опережение, а не постфактум.",
              )}
            </p>
            <div className="mt-8 flex flex-wrap gap-3.5">
              <a href={MAILTO.demo}>
                <PrimaryButton className="px-6 py-3.5 text-[15px]">
                  {t("Запросить демо")} <ArrowRight className="h-4 w-4" />
                </PrimaryButton>
              </a>
              <GhostButton href="#twin">{t("Как это работает")}</GhostButton>
            </div>
            <div className="mt-9 flex flex-wrap gap-x-9 gap-y-5">
              <HeroStat n="0–100" l={t("оценка риска здания")} />
              <HeroStat n={t("<10 мин")} l={t("норматив прибытия")} />
              <HeroStat n="SHAP" l={t("объяснимая модель")} />
            </div>
          </div>

          {/* Live interactive 3D floor */}
          <div>
            <div className="relative h-[400px] overflow-hidden rounded-[20px] border border-border bg-surface shadow-pop sm:h-[460px] lg:h-[500px]">
              <LandingHero3D className="h-full w-full" />
              <span className="pointer-events-none absolute right-3 top-3 rounded-[10px] border border-accent/30 bg-accent-weak px-2.5 py-1 text-[11px] font-semibold text-accent">
                {t("Реальная геометрия · 3D")}
              </span>
            </div>
            <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-faint">
              {t(
                "Реальная геометрия типового этажа ЖК «Хайвилл-Астана» из оперативного плана тушения. Вращайте, кликайте по помещениям.",
              )}
            </p>
          </div>
        </div>
      </section>

      {/* ── Trust / numbers strip ── */}
      <Section id="numbers">
        <div className="rounded-[20px] border border-border bg-surface p-7 shadow-card sm:p-9">
          <div className="grid gap-8 sm:grid-cols-3 lg:grid-cols-5">
            {STATS.map((s, i) => (
              <Reveal key={s.l} delay={i * 70}>
                <div className="text-[clamp(1.9rem,4vw,2.6rem)] font-extrabold leading-none tracking-tight">
                  <CountUp value={s.n} className="tabular" />
                </div>
                <div className="mt-2.5 text-[13px] leading-snug text-muted">{t(s.l)}</div>
              </Reveal>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-border pt-6">
            {TRUST.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-2 text-[13px] text-muted">
                <item.icon className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden />
                {t(item.label)}
              </span>
            ))}
          </div>
          <p className="mt-5 text-[12px] leading-relaxed text-faint">
            {t(
              "Данные пилота (Астана). Риск-оценки рассчитаны на синтетических признаках и не отражают реальное состояние объектов — до загрузки исторических данных ДЧС.",
            )}
          </p>
        </div>
      </Section>

      {/* ── Audience fork ── */}
      <Section id="audience">
        <Reveal>
          <SectionHead
            center
            eyebrow={t("Два контура")}
            title={t("Кому нужен FireWatch")}
            sub={t(
              "Государству — платформа для города и региона. Бизнесу — цифровой паспорт объекта. Выберите свой контур.",
            )}
          />
        </Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {FORK.map((f, i) => (
            <Reveal key={f.href} delay={i * 70}>
              <Link
                href={f.href}
                className="group flex flex-col rounded-[20px] border border-border bg-surface p-7 shadow-card transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-pop sm:p-9"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-[46px] w-[46px] place-items-center rounded-xl border border-border bg-surface-2 text-fg transition-colors group-hover:border-border-strong">
                    <f.icon className="h-5 w-5" strokeWidth={1.9} />
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-accent">
                    {t(f.eyebrow)}
                  </span>
                </div>
                <h3 className="mt-5 text-[clamp(1.35rem,2.6vw,1.7rem)] font-extrabold tracking-tight">
                  {t(f.title)}
                </h3>
                <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">{t(f.sub)}</p>
                <ul className="mt-5 space-y-2.5">
                  {f.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2.5 text-[14px] text-fg">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                      {t(b)}
                    </li>
                  ))}
                </ul>
                <span className="mt-7 inline-flex items-center gap-2 text-[14.5px] font-semibold text-accent">
                  {t(f.cta)}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── Paper ПТП → digital 3D twin (the differentiator) ── */}
      <div className="bg-surface-2">
        <Section id="twin">
          <Reveal>
            <SectionHead
              center
              eyebrow={t("Оцифровка")}
              title={t("Из бумажного ПТП — в цифровой 3D-двойник")}
              sub={t(
                "Планы тушения годами лежат в .vsd и сканах. Мы восстанавливаем из них реальную геометрию помещений — и она сразу становится интерактивной.",
              )}
            />
          </Reveal>
          <div className="mt-14 grid items-stretch gap-5 md:grid-cols-3">
            {PIPELINE.map((p, i) => (
              <Reveal key={p.k} delay={i * 70}>
              <div className="relative flex flex-col">
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
                  <h3 className="mt-3 text-[16.5px] font-bold tracking-tight">{t(p.title)}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-muted">{t(p.text)}</p>
                </div>
              </div>
              </Reveal>
            ))}
          </div>
          <p className="mt-6 text-center text-[12.5px] text-faint">
            {t(
              "На примере поквартирной экспликации ЖК «Хайвилл-Астана». Полигоны калиброваны по площадям из ПТП — это оцифровка реального документа, а не иллюстрация.",
            )}
          </p>
        </Section>
      </div>

      {/* ── Modules ── */}
      <Section id="modules">
        <Reveal>
          <SectionHead
            center
            eyebrow={t("Платформа")}
            title={t("Шесть модулей — один контур безопасности")}
            sub={t("Каждый закрывает свою боль ведомства и работает с общими данными.")}
          />
        </Reveal>
        <div className="mt-12 grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m, i) => (
            <Reveal key={m.k} delay={i * 70}>
              <div className="group rounded-[16px] border border-border bg-surface p-6 shadow-card transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-pop">
                <div className="flex items-center gap-3">
                  <span className="grid h-[42px] w-[42px] place-items-center rounded-xl border border-border bg-surface-2 text-fg transition-colors group-hover:border-border-strong">
                    <m.icon className="h-5 w-5" strokeWidth={1.9} />
                  </span>
                  <span className="text-[11px] font-bold tracking-[0.1em] text-faint">{m.k}</span>
                </div>
                <h3 className="mt-4 text-[16.5px] font-bold tracking-tight">{t(m.title)}</h3>
                <p className="mt-2.5 text-[12.5px] font-semibold text-accent">{t(m.pain)}</p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{t(m.text)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── How it works ── */}
      <div className="bg-surface-2">
        <Section id="how">
          <Reveal>
            <SectionHead
              center
              eyebrow={t("Как работает")}
              title={t("От данных — к действию за три шага")}
              sub={t(
                "FireWatch собирает данные, прогнозирует риск и превращает прогноз в конкретные задачи для инспекторов.",
              )}
            />
          </Reveal>
          <div className="mt-[52px] grid gap-6 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <Reveal key={s.title} delay={i * 70}>
                <div className="relative pt-5">
                  {i < STEPS.length - 1 && (
                    <span className="absolute left-10 top-[26px] hidden h-0.5 w-full bg-gradient-to-r from-border-strong to-transparent sm:block" />
                  )}
                  <span className="text-[13px] font-extrabold tracking-wider text-accent">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-3.5 text-[19px] font-bold tracking-tight">{t(s.title)}</h3>
                  <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">{t(s.text)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Section>
      </div>

      {/* ── Final CTA ── */}
      <section className="px-5 pb-24 sm:px-6">
        <Reveal>
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
              {t("Покажем FireWatch на данных вашего региона")}
            </h2>
            <p className="relative mx-auto mt-4 max-w-[520px] text-[17px] text-muted">
              {t(
                "Демо за 30 минут: карта риска, прогноз модели, маршрут инспектора и 3D-двойник объекта на реальном городе.",
              )}
            </p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3.5">
              <a href={MAILTO.demo}>
                <PrimaryButton className="px-6 py-3.5 text-[15px]">{t("Запросить демо")}</PrimaryButton>
              </a>
              <GhostButton href="/gov" className="bg-surface">
                {t("Платформа для ДЧС")}
              </GhostButton>
            </div>
            <p className="relative mt-5 text-[13px] text-faint">
              {t("Без обязательств · 30 минут · на данных вашего региона")}
            </p>
          </div>
        </Reveal>
      </section>

      <LandingFooter tagline={t("Предиктивная пожарная безопасность · ДЧС РК · Астана")} />
    </div>
  );
}
