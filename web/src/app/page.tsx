"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Flame,
  ArrowRight,
  Menu,
  X,
  Clock,
  Building2,
  EyeOff,
  Map,
  Brain,
  ScanLine,
  Route,
  Droplets,
  Sparkles,
  BarChart3,
  FileCheck,
  ShieldCheck,
  Lock,
  AlertTriangle,
  Check,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { DEFAULT_ROUTE } from "@/lib/nav";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "@/components/ThemeToggle";

/* ── Content ─────────────────────────────────────────────────────────── */

const PROBLEMS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Clock,
    title: "Реакция, а не профилактика",
    text: "Выезд начинается, когда здание уже горит. Предотвратить дешевле и безопаснее, чем тушить — но для этого нужно знать заранее.",
  },
  {
    icon: Building2,
    title: "250 000 зданий — не охватить вручную",
    text: "Инспекторов физически не хватает, чтобы проверить всё. Без приоритизации проверки идут «по списку», а не по реальному риску.",
  },
  {
    icon: EyeOff,
    title: "Решения вслепую",
    text: "Данные о зданиях, гидрантах и инцидентах разрознены. Руководитель не видит общей картины и не может обосновать, куда направить силы.",
  },
];

const STEPS: { title: string; text: string }[] = [
  {
    title: "Сбор данных",
    text: "Здания из OSM и кадастра, история инцидентов за 3 года, гидранты, пожарные части. Оперкарточки распознаёт Claude — строго из документа, без выдумок.",
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

const MODULES: {
  k: string;
  icon: LucideIcon;
  tint: string;
  title: string;
  pain: string;
  text: string;
}[] = [
  {
    k: "01 · CORE",
    icon: Map,
    tint: "bg-accent/10 text-accent",
    title: "Карта риска",
    pain: "Где загорится вероятнее всего?",
    text: "Каждое здание окрашено по оценке 0–100. Фильтры, клик → карточка с историей и SHAP-объяснением.",
  },
  {
    k: "02 · ML",
    icon: Brain,
    tint: "bg-info/10 text-info",
    title: "Прогноз и объяснение",
    pain: "Почему именно 87 из 100?",
    text: "XGBoost + SHAP: виден вклад каждого фактора. Ежедневный пересчёт по всему городу.",
  },
  {
    k: "03 · AI",
    icon: ScanLine,
    tint: "bg-violet-500/10 text-violet-600",
    title: "Оперкарточки",
    pain: "Час ручного ввода — в минуту",
    text: "Скан ОК-1 → Claude извлекает поля → автопредписания из выявленных нарушений.",
  },
  {
    k: "04 · OPS",
    icon: Route,
    tint: "bg-normal/10 text-emerald-600",
    title: "План инспекций",
    pain: "Кого проверять сегодня?",
    text: "Маршрут на день по риску и сроку, мобильный чек-лист с фото, дашборд выполнения.",
  },
  {
    k: "05 · INFRA",
    icon: Droplets,
    tint: "bg-sky-500/10 text-sky-600",
    title: "Инфраструктура",
    pain: "Куда не успеть за 10 минут?",
    text: "Гидранты, части, изохроны прибытия и автоподсветка «слепых зон» покрытия.",
  },
  {
    k: "06 · CHAT",
    icon: Sparkles,
    tint: "bg-accent/10 text-accent",
    title: "ИИ-аналитик",
    pain: "Ответ без ручных выгрузок",
    text: "Вопрос на естественном языке → ответ строго из данных ДЧС, с указанием источников.",
  },
];

const TRUST: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: BarChart3,
    title: "Объяснимая модель",
    text: "SHAP показывает, какие факторы дали оценку. Никаких «чёрных ящиков».",
  },
  {
    icon: FileCheck,
    title: "ИИ не выдумывает",
    text: "Claude извлекает поля только из документа, с флагом уверенности.",
  },
  {
    icon: ShieldCheck,
    title: "Журнал аудита",
    text: "Все действия фиксируются неизменяемо (WORM). Прослеживаемость решений.",
  },
  {
    icon: Lock,
    title: "Данные в РК",
    text: "Роли, разграничение доступа, локализация данных под требования РК.",
  },
];

const STATS: { n: string; u?: string; l: string }[] = [
  { n: "~250", u: "тыс.", l: "зданий Астаны — целевой охват" },
  { n: "30", u: "+", l: "признаков в модели риска" },
  { n: "6", l: "модулей в одной платформе" },
  { n: "30", u: "дней", l: "до пилота после LOI" },
];

const NAV_LINKS = [
  { href: "#problem", label: "Проблема" },
  { href: "#how", label: "Как работает" },
  { href: "#modules", label: "Модули" },
  { href: "#trust", label: "Доверие" },
];

const DEMO_MAILTO =
  "mailto:nurtilek.assankhan@gmail.com?subject=Запрос%20демо%20FireWatch";

/* ── Page ────────────────────────────────────────────────────────────── */

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
      <section className="relative overflow-hidden px-5 pb-12 pt-14 sm:px-6 sm:pb-16 sm:pt-20">
        {/* ambient glows */}
        <div
          className="pointer-events-none absolute -right-32 -top-40 h-[520px] w-[520px] rounded-full opacity-50 blur-[80px]"
          style={{ background: "radial-gradient(circle, rgba(255,90,31,.28), transparent 70%)" }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -left-36 top-28 h-[420px] w-[420px] rounded-full opacity-50 blur-[80px]"
          style={{ background: "radial-gradient(circle, rgba(61,155,255,.16), transparent 70%)" }}
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-[1180px] items-center gap-12 lg:grid-cols-[1.05fr_.95fr] lg:gap-14">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-2 py-1.5 pr-3.5 text-[12.5px] font-semibold text-muted shadow-card">
              <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] text-white">Пилот</span>
              Астана · ~250 000 зданий — периметр пилота
            </span>
            <h1 className="mt-5 max-w-[12ch] text-[clamp(2.1rem,5vw,3.5rem)] font-extrabold leading-[1.04] tracking-tight">
              Пожары можно{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: "linear-gradient(120deg,var(--color-fg) 40%,var(--color-accent) 115%)" }}
              >
                предсказывать
              </span>{" "}
              — до того, как они начнутся
            </h1>
            <p className="mt-5 max-w-[540px] text-[clamp(1rem,2vw,1.2rem)] leading-relaxed text-muted">
              FireWatch — предиктивная аналитика пожарной безопасности для ДЧС РК. Модель
              оценивает риск каждого здания, объясняет почему и направляет инспекторов туда,
              где это важнее всего.
            </p>
            <div className="mt-8 flex flex-wrap gap-3.5">
              <a href={DEMO_MAILTO}>
                <PrimaryButton className="px-6 py-3.5 text-[15px]">
                  Запросить демо <ArrowRight className="h-4 w-4" />
                </PrimaryButton>
              </a>
              <a
                href="#how"
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

          <HeroPreview />
        </div>
      </section>

      {/* ── Problem ── */}
      <Section id="problem">
        <SectionHead
          eyebrow="Проблема"
          title="Сегодня с пожарами борются постфактум"
          sub="Система реагирует, когда уже горит. Ресурсов на сплошные проверки не хватает, а решения принимаются без данных о том, где риск выше всего."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PROBLEMS.map((p) => (
            <div
              key={p.title}
              className="rounded-[14px] border border-border bg-surface p-6 shadow-card"
            >
              <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-accent/10 text-accent">
                <p.icon className="h-[22px] w-[22px]" strokeWidth={2} />
              </span>
              <h3 className="text-[17px] font-bold tracking-tight">{p.title}</h3>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">{p.text}</p>
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
              className="group rounded-[14px] border border-border bg-surface p-6 shadow-card transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-pop"
            >
              <div className="flex items-center gap-3">
                <span className={cn("grid h-[42px] w-[42px] place-items-center rounded-xl", m.tint)}>
                  <m.icon className="h-5 w-5" strokeWidth={2} />
                </span>
                <span className="text-[11px] font-bold tracking-[0.1em] text-muted">{m.k}</span>
              </div>
              <h3 className="mt-4 text-[16.5px] font-bold tracking-tight">{m.title}</h3>
              <p className="mt-2.5 text-[12.5px] font-semibold text-accent">{m.pain}</p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{m.text}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Trust (dark) ── */}
      <section
        id="trust"
        className="bg-gradient-to-b from-zinc-950 to-[#121215] px-5 py-20 text-zinc-100 sm:px-6 sm:py-24"
      >
        <div className="mx-auto max-w-[1180px]">
          <div className="max-w-[680px]">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
              Почему этому можно доверять
            </span>
            <h2 className="mt-3.5 text-[clamp(1.6rem,3.6vw,2.5rem)] font-extrabold leading-tight tracking-tight text-white">
              Госуровень ответственности — заложен в систему
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-zinc-400">
              Прогноз, который нельзя проверить, бесполезен для ведомства. Каждое решение
              объяснимо и прослеживаемо.
            </p>
          </div>
          <div className="mt-12 grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map((t) => (
              <div
                key={t.title}
                className="rounded-[14px] border border-white/10 bg-white/[0.03] p-6"
              >
                <span className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-accent">
                  <t.icon className="h-[18px] w-[18px]" strokeWidth={2} />
                </span>
                <h3 className="text-[15.5px] font-bold text-white">{t.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-400">{t.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-16 grid gap-6 border-t border-white/10 pt-11 sm:grid-cols-2 lg:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.l}>
                <div className="text-[38px] font-extrabold leading-none tracking-tight text-white">
                  <span className="tabular">{s.n}</span>
                  {s.u && <span className="text-[20px] text-accent">{s.u}</span>}
                </div>
                <div className="mt-2 text-[13px] text-zinc-400">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="px-5 py-24 sm:px-6">
        <div className="relative mx-auto max-w-[1180px] overflow-hidden rounded-[28px] border border-zinc-800 bg-gradient-to-br from-[#16161a] to-[#0a0a0b] px-6 py-16 text-center sm:px-12">
          <div
            className="pointer-events-none absolute -top-28 left-1/2 h-[300px] w-[600px] -translate-x-1/2 blur-[50px]"
            style={{ background: "radial-gradient(ellipse, rgba(255,90,31,.3), transparent 70%)" }}
            aria-hidden
          />
          <h2 className="relative text-[clamp(1.6rem,3.6vw,2.4rem)] font-extrabold leading-tight tracking-tight text-white">
            Покажем FireWatch на данных вашего региона
          </h2>
          <p className="relative mx-auto mt-4 max-w-[520px] text-[17px] text-zinc-400">
            Демо за 30 минут: карта риска, прогноз модели и маршрут инспектора на реальном
            городе.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3.5">
            <a href={DEMO_MAILTO}>
              <PrimaryButton className="px-6 py-3.5 text-[15px]">Запросить демо</PrimaryButton>
            </a>
            <Link
              href={appHref}
              className="inline-flex items-center gap-2 rounded-[12px] border border-zinc-700 bg-transparent px-6 py-3.5 text-[15px] font-semibold text-white transition-colors hover:border-zinc-500"
            >
              {appLabel}
            </Link>
          </div>
          <p className="relative mt-5 text-[13px] text-zinc-500">
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

/* ── Pieces ──────────────────────────────────────────────────────────── */

function Brand({ small }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 font-extrabold tracking-tight">
      <span
        className={cn(
          "grid place-items-center rounded-[9px] bg-gradient-to-br from-accent to-[#e6440f] text-white",
          small ? "h-[26px] w-[26px]" : "h-[30px] w-[30px]",
        )}
        style={{ boxShadow: "0 6px 16px -4px rgba(255,90,31,.55)" }}
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
        "inline-flex items-center gap-2 rounded-[12px] bg-gradient-to-b from-accent to-[#e6440f] px-[18px] py-2.5 text-sm font-semibold text-white transition-shadow",
        className,
      )}
      style={{ boxShadow: "0 8px 20px -6px rgba(255,90,31,.5)" }}
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

/* Dark product preview — risk map + scored building + SHAP */
function HeroPreview() {
  return (
    <div
      className="relative"
      role="img"
      aria-label="Превью интерфейса FireWatch: карта риска зданий Астаны с оценкой выбранного объекта и объяснением модели"
    >
      <div className="overflow-hidden rounded-[20px] border border-zinc-800 bg-[#0a0a0b] shadow-[0_40px_80px_-20px_rgba(13,13,18,.32),0_12px_32px_rgba(13,13,18,.12)]">
        {/* window bar */}
        <div className="flex items-center gap-1.5 border-b border-zinc-800 bg-[#16161a] px-3.5 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-2 text-[11.5px] font-semibold tracking-wide text-zinc-500">
            FireWatch · Карта риска — Астана
          </span>
        </div>
        <div className="grid h-[300px] grid-cols-[1fr_178px]">
          {/* map */}
          <div
            className="relative"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px)",
              backgroundSize: "28px 28px, 28px 28px",
              backgroundColor: "#0a0a0b",
            }}
          >
            <svg viewBox="0 0 360 300" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
              <g stroke="#2a2a31" strokeWidth="6" opacity="0.7">
                <line x1="0" y1="90" x2="360" y2="110" />
                <line x1="0" y1="200" x2="360" y2="190" />
                <line x1="120" y1="0" x2="110" y2="300" />
                <line x1="250" y1="0" x2="270" y2="300" />
              </g>
              <g opacity="0.95">
                <rect x="30" y="40" width="26" height="20" rx="2" fill="var(--color-normal)" />
                <rect x="62" y="44" width="22" height="18" rx="2" fill="var(--color-normal)" />
                <rect x="150" y="36" width="30" height="24" rx="2" fill="var(--color-elevated)" />
                <rect x="190" y="50" width="22" height="18" rx="2" fill="var(--color-normal)" />
                <rect x="290" y="40" width="28" height="22" rx="2" fill="var(--color-high)" />
                <rect x="40" y="130" width="26" height="22" rx="2" fill="var(--color-elevated)" />
                <rect x="150" y="125" width="34" height="30" rx="2" fill="var(--color-critical)" stroke="#fff" strokeWidth="1.5" />
                <rect x="200" y="135" width="24" height="20" rx="2" fill="var(--color-high)" />
                <rect x="295" y="128" width="26" height="22" rx="2" fill="var(--color-elevated)" />
                <rect x="44" y="235" width="26" height="20" rx="2" fill="var(--color-normal)" />
                <rect x="150" y="232" width="28" height="22" rx="2" fill="var(--color-high)" />
                <rect x="200" y="240" width="22" height="18" rx="2" fill="var(--color-elevated)" />
                <rect x="300" y="236" width="26" height="20" rx="2" fill="var(--color-normal)" />
              </g>
              <circle cx="167" cy="140" r="26" fill="none" stroke="var(--color-critical)" strokeWidth="1.5" opacity="0.6" />
            </svg>
            <div className="absolute bottom-3 left-3 flex gap-2.5 rounded-[9px] border border-zinc-800 bg-zinc-950/70 px-2.5 py-1.5 backdrop-blur">
              <LegendDot color="var(--color-critical)" label="Высокий" />
              <LegendDot color="var(--color-elevated)" label="Средний" />
              <LegendDot color="var(--color-normal)" label="Низкий" />
            </div>
          </div>
          {/* side panel */}
          <div className="border-l border-zinc-800 bg-[#16161a] p-3.5">
            <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              Объект · ул. Бейбітшілік 12
            </div>
            <div className="relative mx-auto mt-3 h-24 w-24">
              <svg viewBox="0 0 96 96" className="h-full w-full">
                <circle cx="48" cy="48" r="40" fill="none" stroke="#1f1f25" strokeWidth="9" />
                <circle
                  cx="48"
                  cy="48"
                  r="40"
                  fill="none"
                  stroke="var(--color-critical)"
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray="251"
                  strokeDashoffset="35"
                  transform="rotate(-90 48 48)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <b className="text-[26px] font-extrabold leading-none text-white">87</b>
                <span className="text-[9px] text-zinc-500">/ 100</span>
              </div>
            </div>
            <div className="mt-2.5 flex flex-col gap-2">
              <ShapRow label="Деревянные перекрытия" w="82%" />
              <ShapRow label="Нет сигнализации" w="64%" />
              <ShapRow label="Возраст 58 лет" w="48%" />
            </div>
          </div>
        </div>
      </div>

      {/* floating cards */}
      <FloatCard
        className="-top-4 right-2 sm:-right-4 sm:top-8"
        tint="bg-critical/10 text-critical"
        icon={AlertTriangle}
        title="3 здания в зоне"
        sub="риск вырос за неделю"
      />
      <FloatCard
        className="-bottom-4 left-2 sm:-left-6 sm:bottom-6"
        tint="bg-normal/10 text-emerald-600"
        icon={Check}
        title="Маршрут готов"
        sub="12 инспекций · 07:00"
      />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[9.5px] text-zinc-400">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function ShapRow({ label, w }: { label: string; w: string }) {
  return (
    <div className="text-[10px] text-zinc-200">
      {label}
      <div className="mt-1 h-[5px] overflow-hidden rounded-[3px] bg-zinc-800">
        <span
          className="block h-full rounded-[3px]"
          style={{ width: w, background: "linear-gradient(90deg, var(--color-high), var(--color-critical))" }}
        />
      </div>
    </div>
  );
}

function FloatCard({
  className,
  tint,
  icon: Icon,
  title,
  sub,
}: {
  className?: string;
  tint: string;
  icon: LucideIcon;
  title: string;
  sub: string;
}) {
  return (
    <div
      className={cn(
        "absolute flex items-center gap-3 rounded-[13px] border border-border bg-surface px-3.5 py-3 shadow-pop",
        className,
      )}
    >
      <span className={cn("grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px]", tint)}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
      </span>
      <div>
        <div className="text-[12px] font-bold leading-tight text-fg">{title}</div>
        <div className="text-[11px] text-muted">{sub}</div>
      </div>
    </div>
  );
}
