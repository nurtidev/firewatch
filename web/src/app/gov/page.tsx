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
import { Reveal, CountUp } from "@/components/landing/reveal";
import { useT } from "@/lib/i18n";

const LandingHero3D = dynamic(() => import("@/components/LandingHero3D"), {
  ssr: false,
  loading: () => <Hero3DSkeleton plan={HERO_PLAN} />,
});

const plan = (id: string): RealFloorPlan =>
  HAYVILL_FLOORPLANS.find((p) => p.id === id) ?? HAYVILL_FLOORPLANS[0];
const HERO_PLAN = plan("typical");

/* ── Content ─────────────────────────────────────────────────────────────── */

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

/** Цена вопроса: только факты с надёжным первоисточником (см. docs/commercial/06_economic_effect.md).
 *  ROI-сценарии сознательно не выносим на публичную страницу — они живут в КП. */
const STAKES: {
  n: string;
  label: string;
  source: string;
  count?: { value: number; decimals?: number; prefix?: string; suffix?: string };
}[] = [
  {
    n: "1 из 36",
    label: "пожаров в РК уносит жизнь — в США гибелью заканчивается 1 из 360",
    source: "МЧС РК · 2021",
  },
  {
    n: "9,3 млрд ₸",
    label: "прямой материальный ущерб от пожаров за год; 413 погибших",
    source: "МЧС РК · 2021",
    count: { value: 9.3, decimals: 1, suffix: " млрд ₸" },
  },
  {
    n: "58–62%",
    label: "пожаров происходит в жилом секторе; до половины причин устранимы профилактической проверкой",
    source: "МЧС РК · 2021–2025",
  },
  {
    n: "1,6",
    label: "нарушения пожарной безопасности на каждый дом, обойденный в рейдах по частному сектору Астаны",
    source: "ДЧС Астаны · 2024",
    count: { value: 1.6, decimals: 1 },
  },
];

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function GovLanding() {
  const t = useT();

  const navLinks: NavLink[] = [
    { href: "#modules", label: t("Платформа") },
    { href: "#pilot", label: t("Пилот") },
    { href: "#trust", label: t("Безопасность") },
    { href: "/business", label: t("Для бизнеса") },
  ];

  return (
    <div className="min-h-screen bg-bg text-fg">
      <LandingHeader navLinks={navLinks} cta={{ label: t("Запросить пилот"), href: MAILTO.pilot }} />

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
                {t("МЧС РК")}
              </span>
              {t("Ведомственная платформа · пилот в Астане")}
            </span>
            <h1 className="mt-5 text-[clamp(2.15rem,5vw,3.6rem)] font-extrabold leading-[1.05] tracking-tight">
              {t("Прогноз пожарного риска")}{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg,var(--color-fg) 45%,var(--color-accent) 120%)",
                }}
              >
                {t("для всего города")}
              </span>
            </h1>
            <p className="mt-5 max-w-[550px] text-[clamp(1rem,2vw,1.2rem)] leading-relaxed text-muted">
              {t(
                "FireWatch оценивает риск каждого из ~250 000 зданий, объясняет каждую оценку и превращает прогноз в маршруты инспекций и карту «слепых зон» прибытия расчётов — чтобы ДЧС действовал на опережение.",
              )}
            </p>
            <div className="mt-8 flex flex-wrap gap-3.5">
              <a href={MAILTO.pilot}>
                <PrimaryButton className="px-6 py-3.5 text-[15px]">
                  {t("Запросить пилот")} <ArrowRight className="h-4 w-4" />
                </PrimaryButton>
              </a>
              <GhostButton href={MAILTO.presentation}>{t("Презентация платформы")}</GhostButton>
            </div>
            <div className="mt-9 flex flex-wrap gap-x-9 gap-y-5">
              <HeroStat n="~250 000" l={t("зданий города")} />
              <HeroStat n={t("<10 мин")} l={t("норматив прибытия")} />
              <HeroStat n="SHAP" l={t("объяснимая модель")} />
            </div>
          </div>

          {/* Stylised city risk map */}
          <div>
            <div className="relative h-[400px] overflow-hidden rounded-[20px] border border-border bg-surface shadow-pop sm:h-[460px] lg:h-[500px]">
              <RiskCityMap />
            </div>
            <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-faint">
              {t(
                "Стилизация карты риска на условных данных. Реальная карта строится на исторических данных пожаров вашего региона — каждое здание с оценкой 0–100.",
              )}
            </p>
          </div>
        </div>
      </section>

      {/* ── Problems ── */}
      <div className="bg-surface-2">
        <Section id="problems">
          <Reveal>
            <SectionHead
              center
              eyebrow={t("Задача ведомства")}
              title={t("Надзор за городом — вручную не масштабируется")}
              sub={t(
                "Объём объектов и разрозненные документы не дают увидеть риск целиком. FireWatch собирает эту картину в одном контуре.",
              )}
            />
          </Reveal>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {PROBLEMS.map((p, i) => (
              <Reveal key={p.title} delay={i * 70}>
                <div className="flex flex-col rounded-[16px] border border-border bg-surface p-6 shadow-card">
                  <span className="grid h-[46px] w-[46px] place-items-center rounded-xl border border-border bg-surface-2 text-fg">
                    <p.icon className="h-5 w-5" strokeWidth={1.9} />
                  </span>
                  <h3 className="mt-5 text-[17px] font-bold tracking-tight">{t(p.title)}</h3>
                  <p className="mt-2.5 text-[14px] leading-relaxed text-muted">{t(p.text)}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Section>
      </div>

      {/* ── Stakes: цена вопроса в проверенных цифрах ── */}
      <Section id="stakes">
        <Reveal>
          <SectionHead
            center
            eyebrow={t("Цена вопроса")}
            title={t("Сколько стоит год без приоритизации")}
            sub={t("Официальная статистика — из выступлений должностных лиц МЧС РК и ДЧС Астаны.")}
          />
        </Reveal>
        <div className="mt-12 grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
          {STAKES.map((s, i) => (
            <Reveal key={s.n} delay={i * 70}>
              <div className="flex flex-col rounded-[16px] border border-border bg-surface p-6 shadow-card">
                <div className="text-[clamp(1.7rem,2.6vw,2.15rem)] font-extrabold leading-none tracking-tight tabular">
                  {s.count ? (
                    <CountUp
                      value={s.count.value}
                      decimals={s.count.decimals}
                      prefix={s.count.prefix}
                      suffix={s.count.suffix}
                    />
                  ) : (
                    t(s.n)
                  )}
                </div>
                <p className="mt-3 flex-1 text-[13.5px] leading-relaxed text-muted">{t(s.label)}</p>
                <p className="mt-4 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-faint">
                  {t(s.source)}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-[640px] text-center text-[13.5px] leading-relaxed text-muted">
          {t("По нашему расчёту система окупается уже в консервативном сценарии.")}{" "}
          <a href={MAILTO.presentation} className="font-semibold text-accent hover:underline">
            {t("Запросите детальное экономическое обоснование")}
          </a>{" "}
          {t("— с методикой, источниками и допущениями.")}
        </p>
      </Section>

      {/* ── Modules ── */}
      <Section id="modules">
        <Reveal>
          <SectionHead
            center
            eyebrow={t("Платформа")}
            title={t("Шесть модулей — один контур надзора")}
            sub={t("Каждый модуль закрывает свою задачу ведомства и работает на общих данных ДЧС.")}
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

      {/* ── Pilot ── */}
      <div className="bg-surface-2">
        <Section id="pilot">
          <Reveal>
            <SectionHead
              center
              eyebrow={t("Пилот")}
              title={t("Как проходит пилот")}
              sub={t(
                "3 месяца, 1 район Астаны. ДЧС получает рабочую систему на реальных данных района — и обоснованное решение о развёртывании на весь город.",
              )}
            />
          </Reveal>
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PILOT.map((s, i) => (
              <Reveal key={s.week} delay={i * 70}>
                <div className="relative flex flex-col rounded-[16px] border border-border bg-surface p-6 shadow-card">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-accent text-[13px] font-extrabold text-accent-fg tabular">
                      {i + 1}
                    </span>
                    <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-accent">
                      {t(s.week)}
                    </span>
                  </div>
                  <h3 className="mt-4 text-[16px] font-bold tracking-tight">{t(s.title)}</h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{t(s.text)}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <p className="mt-6 text-center text-[12.5px] text-faint">
            {t(
              "Что нужно от ДЧС: письмо о намерениях (LOI), история пожаров района за 2–3 года и реестр объектов, 1–2 контактных инспектора. Оцифровка до 20 объектов — в рамках пилота.",
            )}
          </p>
        </Section>
      </div>

      {/* ── Trust / security (the differentiator) ── */}
      <Section id="trust">
        <Reveal>
          <SectionHead
            center
            eyebrow={t("Доверие и безопасность")}
            title={t("Ведомственный контур — по умолчанию")}
            sub={t(
              "FireWatch спроектирован под требования госзаказчика: аудируемость, защита персональных данных, объяснимость и работа в форматах МЧС РК.",
            )}
          />
        </Reveal>
        <div className="mt-12 grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
          {TRUST.map((item, i) => (
            <Reveal key={item.title} delay={i * 70}>
              <div className="rounded-[16px] border border-border bg-surface p-6 shadow-card">
                <span className="grid h-[42px] w-[42px] place-items-center rounded-xl border border-border bg-surface-2 text-accent">
                  <item.icon className="h-5 w-5" strokeWidth={1.9} />
                </span>
                <h3 className="mt-4 text-[16px] font-bold tracking-tight">{t(item.title)}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">{t(item.text)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* ── Digital twin (brief; full story on /) ── */}
      <div className="bg-surface-2">
        <Section id="twin">
          <Reveal>
            <div className="grid items-center gap-10 lg:grid-cols-[.9fr_1.1fr] lg:gap-16 [&>div]:min-w-0">
              <div>
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
                  {t("Цифровой двойник")}
                </span>
                <h2 className="mt-3.5 text-[clamp(1.55rem,3.4vw,2.3rem)] font-extrabold leading-tight tracking-tight">
                  {t("Бумажный ПТП — в интерактивный 3D")}
                </h2>
                <p className="mt-4 max-w-[480px] text-[16px] leading-relaxed text-muted">
                  {t(
                    "ИИ восстанавливает из сканов и .vsd реальную геометрию помещений: калиброванные полигоны с площадями в м², окрашенные по назначению. Тот же двойник — в оперкарточке объекта.",
                  )}
                </p>
                <div className="mt-7">
                  <GhostButton href="/#twin">
                    {t("Как устроена оцифровка")} <ArrowRight className="h-4 w-4" />
                  </GhostButton>
                </div>
              </div>
              <div>
                <div className="relative h-[360px] overflow-hidden rounded-[20px] border border-border bg-surface shadow-pop sm:h-[420px]">
                  <LandingHero3D className="h-full w-full" />
                  <span className="pointer-events-none absolute right-3 top-3 rounded-[10px] border border-accent/30 bg-accent-weak px-2.5 py-1 text-[11px] font-semibold text-accent">
                    {t("Реальная геометрия · 3D")}
                  </span>
                </div>
                <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-faint">
                  {t(
                    "Типовой этаж ЖК «Хайвилл-Астана» из оперативного плана тушения — реальный объект города, уже оцифрованный в системе.",
                  )}
                </p>
              </div>
            </div>
          </Reveal>
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
              {t("Покажем на данных вашего региона")}
            </h2>
            <p className="relative mx-auto mt-4 max-w-[540px] text-[17px] text-muted">
              {t(
                "Пилот — 3 месяца на одном районе Астаны. Развернём систему на реальных данных района и покажем эффект в цифрах.",
              )}
            </p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3.5">
              <a href={MAILTO.pilot}>
                <PrimaryButton className="px-6 py-3.5 text-[15px]">{t("Запросить пилот")}</PrimaryButton>
              </a>
              <GhostButton href={MAILTO.presentation} className="bg-surface">
                {t("Презентация платформы")}
              </GhostButton>
            </div>
            <p className="relative mt-5 text-[13px] text-faint">
              {t("Без обязательств · на реальных данных района · с обучением сотрудников")}
            </p>
          </div>
        </Reveal>
      </section>

      <LandingFooter tagline={t("Ведомственная платформа пожарной безопасности · МЧС РК")} />
    </div>
  );
}
