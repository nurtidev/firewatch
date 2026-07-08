"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowRight,
  Check,
  Layers,
  ShieldCheck,
  BarChart3,
  ShoppingBag,
  Building2,
  Briefcase,
  HardHat,
  Landmark,
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
import { PIPELINE } from "@/components/landing/content";
import { cn } from "@/lib/cn";
import { Reveal, CountUp } from "@/components/landing/reveal";
import { useT } from "@/lib/i18n";

const LandingHero3D = dynamic(() => import("@/components/LandingHero3D"), {
  ssr: false,
  loading: () => <Hero3DSkeleton plan={HERO_PLAN} />,
});

const plan = (id: string): RealFloorPlan =>
  HAYVILL_FLOORPLANS.find((p) => p.id === id) ?? HAYVILL_FLOORPLANS[0];
const HERO_PLAN = plan("typical");
const PIPELINE_PLAN = plan("apt-2k");

/* ── Content ─────────────────────────────────────────────────────────────── */

const INCLUDES: string[] = [
  "Аудит пожарной безопасности и план эвакуации",
  "2D- и 3D-планы объекта — автогенерация из документов",
  "Оперкарточки: ИИ извлекает поля из ваших документов",
  "Цифровой паспорт: планы, карточки и риск-оценка в одном портале",
  "Предиктивная риск-оценка объекта — которой нет ни у кого в РК",
];

const AUDIENCE: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: ShoppingBag, title: "ТРЦ и ритейл", text: "Большие потоки людей и высокая пожарная нагрузка — паспорт и план эвакуации под контролем." },
  { icon: Building2, title: "ЖК и УК", text: "Управляющим компаниям — единый портал по всем корпусам, планы и риск-оценка в одном месте." },
  { icon: Briefcase, title: "Офисы и бизнес-центры", text: "Аудит ПБ, документы и планы эвакуации без недель ручной работы подрядчика." },
  { icon: HardHat, title: "Застройщики", text: "Цифровой паспорт для сдачи и эксплуатации объекта — 2D/3D сразу из проектной документации." },
];

/** Риск в цифрах для владельца объекта — только факты с первоисточником
 *  (подборка: docs/commercial/06_economic_effect.md). */
const RISK_FACTS: {
  n: string;
  label: string;
  source: string;
  count?: { value: number; decimals?: number; prefix?: string; suffix?: string };
}[] = [
  {
    n: "~55%",
    label: "пожаров начинаются с электрооборудования — проводка, щитки, перегруженные сети. Это вопрос эксплуатации, а не везения",
    source: "МЧС РК · 2025",
    count: { value: 55, prefix: "~", suffix: "%" },
  },
  {
    n: "+41%",
    label: "рост пожаров в многоэтажных домах за год — нагрузка на УК и ЖК растёт",
    source: "МЧС РК · янв–май 2025",
    count: { value: 41, prefix: "+", suffix: "%" },
  },
  {
    n: "219",
    label: "автомобилей сгорело в Астане за год — паркинг ТРЦ и ЖК — зона прямой ответственности владельца",
    source: "ДЧС Астаны · 2025",
    count: { value: 219 },
  },
  {
    n: "1 из 36",
    label: "пожаров в РК заканчивается гибелью людей — для владельца это ответственность, а не только материальный ущерб",
    source: "МЧС РК · 2021",
  },
];

const PRICING: {
  name: string;
  what: string;
  price: string;
  unit: string;
  featured?: boolean;
}[] = [
  {
    name: "Цифровой паспорт объекта",
    what: "Аудит ПБ + план эвакуации + 2D/3D-планы + риск-оценка объекта.",
    price: "от 150 000 ₸",
    unit: "разово, за объект",
    featured: true,
  },
  {
    name: "Портфельный пакет",
    what: "То же, пакетом для девелопера или УК от 10 объектов.",
    price: "−25%",
    unit: "к цене за объект",
  },
  {
    name: "Подписка · мониторинг",
    what: "Паспорт всегда актуален: обновление, портал, доступ инспектору и собственнику.",
    price: "от 30 000 ₸",
    unit: "в месяц за объект",
  },
];

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function BusinessLanding() {
  const t = useT();

  const navLinks: NavLink[] = [
    { href: "#offer", label: t("Паспорт объекта") },
    { href: "#pipeline", label: t("Как это работает") },
    { href: "#pricing", label: t("Стоимость") },
    { href: "/gov", label: t("Для ДЧС") },
  ];

  return (
    <div className="min-h-screen bg-bg text-fg">
      <LandingHeader
        navLinks={navLinks}
        cta={{ label: t("Обсудить оцифровку"), href: MAILTO.business }}
      />

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
                {t("Для бизнеса")}
              </span>
              {t("Цифровой паспорт объекта")}
            </span>
            <h1 className="mt-5 text-[clamp(2.15rem,5vw,3.6rem)] font-extrabold leading-[1.05] tracking-tight">
              {t("Цифровой паспорт объекта")}{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg,var(--color-fg) 45%,var(--color-accent) 120%)",
                }}
              >
                {t("— с ИИ и риск-картой")}
              </span>
            </h1>
            <p className="mt-5 max-w-[540px] text-[clamp(1rem,2vw,1.2rem)] leading-relaxed text-muted">
              {t(
                "Не папка бумаг, а объект в портале: аудит ПБ, план эвакуации, 2D/3D-планы и предиктивная риск-оценка. Конкуренты в РК делают это вручную — мы быстрее, нагляднее и с аналитикой, которой нет ни у кого.",
              )}
            </p>
            <div className="mt-8 flex flex-wrap gap-3.5">
              <a href={MAILTO.business}>
                <PrimaryButton className="px-6 py-3.5 text-[15px]">
                  {t("Обсудить оцифровку объекта")} <ArrowRight className="h-4 w-4" />
                </PrimaryButton>
              </a>
              <GhostButton href="#offer">{t("Что входит")}</GhostButton>
            </div>
            <div className="mt-9 flex flex-wrap gap-x-9 gap-y-5">
              <HeroStat n={t("от 150 000 ₸")} l={t("за объект")} />
              <HeroStat n="2D / 3D" l={t("планы объекта")} />
              <HeroStat n={t("минуты")} l={t("вместо дней ручной работы")} />
            </div>
          </div>

          {/* Interactive 3D twin of the object */}
          <div>
            <div className="relative h-[400px] overflow-hidden rounded-[20px] border border-border bg-surface shadow-pop sm:h-[460px] lg:h-[500px]">
              <LandingHero3D className="h-full w-full" />
              <span className="pointer-events-none absolute right-3 top-3 rounded-[10px] border border-accent/30 bg-accent-weak px-2.5 py-1 text-[11px] font-semibold text-accent">
                {t("3D-двойник объекта")}
              </span>
            </div>
            <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-faint">
              {t(
                "Интерактивный 3D-двойник из планов объекта. Реальная геометрия ЖК «Хайвилл-Астана». Вращайте, кликайте по помещениям.",
              )}
            </p>
          </div>
        </div>
      </section>

      {/* ── What's included ── */}
      <Section id="offer">
        <Reveal>
          <div className="grid grid-cols-1 items-center gap-10 rounded-[24px] border border-border bg-surface p-7 shadow-card lg:grid-cols-[1.1fr_.9fr] lg:p-11 [&>div]:min-w-0">
            <div>
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
                {t("Что входит")}
              </span>
              <h2 className="mt-3.5 text-[clamp(1.55rem,3.4vw,2.3rem)] font-extrabold leading-tight tracking-tight">
                {t("Всё об объекте — в одном портале")}
              </h2>
              <p className="mt-4 max-w-[520px] text-[16px] leading-relaxed text-muted">
                {t(
                  "Цифровой паспорт собирает документы, планы и оценку риска в одном месте — вместо разрозненных файлов и папок.",
                )}
              </p>
              <ul className="mt-6 space-y-2.5">
                {INCLUDES.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-[14.5px] text-fg">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-weak text-accent">
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                    </span>
                    {t(b)}
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <a href={MAILTO.business}>
                  <PrimaryButton className="px-6 py-3.5 text-[15px]">
                    {t("Обсудить оцифровку объекта")} <ArrowRight className="h-4 w-4" />
                  </PrimaryButton>
                </a>
              </div>
            </div>

            {/* real apartment plan as the visual */}
            <div className="rounded-[18px] border border-border bg-surface-2 p-4">
              <div className="mb-3 flex items-center gap-2 text-[12px] font-medium text-muted">
                <Building2 className="h-4 w-4 text-accent" aria-hidden />
                {t("Цифровой паспорт · план помещения")}
              </div>
              <FloorPlan2D plan={plan("apt-4k")} compact className="w-full" />
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-faint">
                <span className="inline-flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5" aria-hidden /> {t("2D / 3D-планы")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {t("Аудит ПБ")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5" aria-hidden /> {t("Риск-оценка")}
                </span>
              </div>
            </div>
          </div>
        </Reveal>
      </Section>

      {/* ── Pipeline: document → vector → 3D ── */}
      <div className="bg-surface-2">
        <Section id="pipeline">
          <Reveal>
            <SectionHead
              center
              eyebrow={t("Как это работает")}
              title={t("Из документов — в цифровой 3D-двойник")}
              sub={t(
                "Планы и экспликации объекта превращаются в калиброванную геометрию — и сразу становятся интерактивными.",
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
              "На примере поквартирной экспликации ЖК «Хайвилл-Астана». Полигоны калиброваны по реальным площадям — это оцифровка документа, а не иллюстрация.",
            )}
          </p>
        </Section>
      </div>

      {/* ── For whom ── */}
      <Section id="audience">
        <Reveal>
          <SectionHead
            center
            eyebrow={t("Для кого")}
            title={t("Кому подходит цифровой паспорт")}
            sub={t(
              "Любому объекту, где есть обязанность по пожарной безопасности и ценно видеть риск заранее.",
            )}
          />
        </Reveal>
        <div className="mt-12 grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
          {AUDIENCE.map((a, i) => (
            <Reveal key={a.title} delay={i * 70}>
              <div className="rounded-[16px] border border-border bg-surface p-6 shadow-card">
                <span className="grid h-[42px] w-[42px] place-items-center rounded-xl border border-border bg-surface-2 text-fg">
                  <a.icon className="h-5 w-5" strokeWidth={1.9} />
                </span>
                <h3 className="mt-4 text-[16px] font-bold tracking-tight">{t(a.title)}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{t(a.text)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── Risk facts: почему это касается вашего объекта ── */}
      <div className="bg-surface-2">
        <Section id="risk">
          <Reveal>
            <SectionHead
              center
              eyebrow={t("Риск в цифрах")}
              title={t("Почему это касается вашего объекта")}
              sub={t("Официальная статистика МЧС РК и ДЧС Астаны — без страшилок, просто цифры.")}
            />
          </Reveal>
          <div className="mt-12 grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
            {RISK_FACTS.map((f, i) => (
              <Reveal key={f.n} delay={i * 70}>
                <div className="flex flex-col rounded-[16px] border border-border bg-surface p-6 shadow-card">
                  <div className="text-[clamp(1.7rem,2.6vw,2.15rem)] font-extrabold leading-none tracking-tight tabular">
                    {f.count ? (
                      <CountUp
                        value={f.count.value}
                        decimals={f.count.decimals}
                        prefix={f.count.prefix}
                        suffix={f.count.suffix}
                      />
                    ) : (
                      t(f.n)
                    )}
                  </div>
                  <p className="mt-3 flex-1 text-[13.5px] leading-relaxed text-muted">{t(f.label)}</p>
                  <p className="mt-4 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint">
                    {t(f.source)}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-[620px] text-center text-[13.5px] leading-relaxed text-muted">
            {t(
              "Цифровой паспорт закрывает первопричину: аудит находит нарушения до пожара, а риск-оценка показывает, какие объекты и системы требуют внимания в первую очередь.",
            )}
          </p>
        </Section>
      </div>

      {/* ── Pricing ── */}
      <div>
        <Section id="pricing">
          <Reveal>
            <SectionHead
              center
              eyebrow={t("Стоимость")}
              title={t("Прозрачные пакеты, а не «звоните — обсудим»")}
              sub={t(
                "Продаём не отдельный документ, а комплексный паспорт, где премию оправдывают скорость, 2D/3D и риск-карта.",
              )}
            />
          </Reveal>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {PRICING.map((p, i) => (
              <Reveal key={p.name} delay={i * 70}>
                <div
                  className={cn(
                    "flex flex-col rounded-[18px] border bg-surface p-7 shadow-card",
                    p.featured ? "border-accent/50 shadow-pop" : "border-border",
                  )}
                >
                  {p.featured && (
                    <span className="mb-3 inline-flex w-fit rounded-full bg-accent-weak px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em] text-accent">
                      {t("Основной пакет")}
                    </span>
                  )}
                  <h3 className="text-[17px] font-bold tracking-tight">{t(p.name)}</h3>
                  <p className="mt-2 min-h-[42px] text-[13.5px] leading-relaxed text-muted">{t(p.what)}</p>
                  <div className="mt-5 border-t border-border pt-5">
                    <div className="text-[clamp(1.5rem,3vw,1.9rem)] font-extrabold tracking-tight tabular">
                      {t(p.price)}
                    </div>
                    <div className="mt-1 text-[12.5px] text-muted">{t(p.unit)}</div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <p className="mt-6 text-center text-[12.5px] leading-relaxed text-faint">
            {t(
              "Цены — ориентир и финализируются по составу и объёму объекта. Расход на ИИ-извлечение — сотые доли процента стоимости; всё остальное — работа над качеством паспорта.",
            )}
          </p>
        </Section>
      </div>

      {/* ── Cross-link to gov ── */}
      <Section id="gov-link">
        <Reveal>
          <Link
            href="/gov"
            className="group flex flex-wrap items-center justify-between gap-5 rounded-[20px] border border-border bg-surface p-7 shadow-card transition-colors hover:border-border-strong sm:p-8"
          >
            <div className="flex items-center gap-4">
              <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-xl border border-border bg-surface-2 text-fg">
                <Landmark className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <div>
                <h3 className="text-[17px] font-bold tracking-tight">{t("Работаете в госсекторе?")}</h3>
                <p className="mt-1 text-[14px] text-muted">
                  {t("Для ДЧС и акиматов — ведомственная платформа с картой риска по всему городу.")}
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 text-[14.5px] font-semibold text-accent">
              {t("Платформа для ДЧС")}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        </Reveal>
      </Section>

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
              {t("Оцифруем ваш объект")}
            </h2>
            <p className="relative mx-auto mt-4 max-w-[520px] text-[17px] text-muted">
              {t(
                "Пришлите планы и документы — соберём цифровой паспорт с 2D/3D и риск-оценкой. Обсудим объём и сроки под ваш объект.",
              )}
            </p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3.5">
              <a href={MAILTO.business}>
                <PrimaryButton className="px-6 py-3.5 text-[15px]">
                  {t("Обсудить оцифровку объекта")}
                </PrimaryButton>
              </a>
              <GhostButton href="/gov" className="bg-surface">
                {t("Для ДЧС и акиматов")}
              </GhostButton>
            </div>
            <p className="relative mt-5 text-[13px] text-faint">
              {t("ИИ-извлечение · 2D/3D-планы · предиктивная риск-оценка объекта")}
            </p>
          </div>
        </Reveal>
      </section>

      <LandingFooter tagline={t("Цифровой паспорт объекта · ТРЦ, ЖК, офисы, застройщики")} />
    </div>
  );
}
