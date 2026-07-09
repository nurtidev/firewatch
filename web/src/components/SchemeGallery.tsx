"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Map } from "lucide-react";
import { Card, SectionLabel, Badge, useDismiss } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import type { ObjectSchemes, SchemePage } from "@/data/schemes";

/** Плоский список страниц + ссылка на группу — для навигации в лайтбоксе. */
type FlatPage = SchemePage & { group: string };

export default function SchemeGallery({ schemes }: { schemes: ObjectSchemes }) {
  const t = useT();
  const flat = useMemo<FlatPage[]>(
    () =>
      schemes.groups.flatMap((g) =>
        g.pages.map((p) => ({ ...p, group: g.label })),
      ),
    [schemes],
  );

  // null = лайтбокс закрыт; иначе индекс в плоском списке.
  const [active, setActive] = useState<number | null>(null);
  const close = useCallback(() => setActive(null), []);
  const step = useCallback(
    (d: number) =>
      setActive((i) => (i == null ? i : (i + d + flat.length) % flat.length)),
    [flat.length],
  );

  return (
    <div className="space-y-5 fw-fade-in">
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Map className="h-3.5 w-3.5 text-faint" aria-hidden />
          <SectionLabel>{t("Схемы ДЧС")}</SectionLabel>
        </div>
        <p className="mt-1 text-xs text-muted">
          {t(
            "Оригинальные схемы из ПТП объекта (оцифрованы из Visio). Клик — открыть лист в полном размере с зумом.",
          )}
        </p>
      </Card>

      {schemes.groups.map((g) => {
        // Базовый индекс группы в плоском списке — для прокидывания в лайтбокс.
        const base = flat.findIndex((p) => p.group === g.label);
        return (
          <Card key={g.id} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionLabel>{t(g.label)}</SectionLabel>
              <Badge>{g.pages.length} {t(plural(g.pages.length))}</Badge>
            </div>
            <p className="mt-1 text-2xs text-faint">{t("Источник:")} {g.source}</p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {g.pages.map((p, i) => (
                <button
                  key={p.src}
                  onClick={() => setActive(base + i)}
                  className="group overflow-hidden rounded-lg border border-border bg-surface-2/40 text-left transition-colors duration-[var(--dur-fast)] hover:border-accent/40"
                >
                  <div className="aspect-[1.414/1] overflow-hidden bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.src}
                      alt={t(p.title)}
                      loading="lazy"
                      className="h-full w-full object-contain transition-transform duration-[var(--dur)] group-hover:scale-[1.03]"
                    />
                  </div>
                  <div className="truncate px-2.5 py-1.5 text-2xs text-muted">
                    {t(p.title)}
                  </div>
                </button>
              ))}
            </div>
          </Card>
        );
      })}

      {active != null && (
        <Lightbox
          page={flat[active]}
          index={active}
          total={flat.length}
          onClose={close}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
        />
      )}
    </div>
  );
}

function Lightbox({
  page,
  index,
  total,
  onClose,
  onPrev,
  onNext,
}: {
  page: FlatPage;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const t = useT();
  const [zoom, setZoom] = useState(false);
  // Fade + subtle scale on enter (~200ms) / faster exit (~140ms). requestClose
  // plays the exit before the parent unmounts the lightbox.
  const { visible, requestClose } = useDismiss(onClose, 140);

  // Зум сбрасывается при смене листа.
  useEffect(() => setZoom(false), [page.src]);

  // Клавиатура: Esc — закрыть, стрелки — листать.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
      else if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    // Заблокировать прокрутку фона, пока открыт лайтбокс.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [requestClose, onPrev, onNext]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t(page.title)}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.98)",
        transition: `opacity ${visible ? 200 : 140}ms var(--ease), transform ${
          visible ? 200 : 140
        }ms var(--ease)`,
      }}
    >
      {/* Верхняя панель */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{t(page.title)}</div>
          <div className="text-2xs text-white/60">
            {t(page.group)} · {index + 1} / {total}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <IconBtn label={zoom ? t("Уменьшить") : t("Увеличить")} onClick={() => setZoom((z) => !z)}>
            {zoom ? <ZoomOut className="h-5 w-5" /> : <ZoomIn className="h-5 w-5" />}
          </IconBtn>
          <IconBtn label={t("Закрыть")} onClick={requestClose}>
            <X className="h-5 w-5" />
          </IconBtn>
        </div>
      </div>

      {/* Полотно */}
      <div
        className={cn(
          "relative flex-1",
          zoom ? "overflow-auto" : "flex items-center justify-center overflow-hidden",
        )}
        onClick={(e) => {
          // Клик по фону (не по изображению) закрывает.
          if (e.target === e.currentTarget) requestClose();
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={page.src}
          alt={t(page.title)}
          onClick={() => setZoom((z) => !z)}
          className={cn(
            "select-none bg-white",
            zoom
              ? "max-w-none cursor-zoom-out"
              : "max-h-full max-w-full cursor-zoom-in object-contain p-2",
          )}
          style={zoom ? { width: "180%" } : undefined}
        />

        {/* Навигация по листам */}
        {total > 1 && (
          <>
            <NavBtn side="left" onClick={onPrev} label={t("Предыдущий лист")}>
              <ChevronLeft className="h-6 w-6" />
            </NavBtn>
            <NavBtn side="right" onClick={onNext} label={t("Следующий лист")}>
              <ChevronRight className="h-6 w-6" />
            </NavBtn>
          </>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-md p-2 text-white/80 transition-[color,background-color,scale] duration-[var(--dur-fast)] hover:bg-white/10 hover:text-white active:scale-[0.97]"
    >
      {children}
    </button>
  );
}

function NavBtn({
  side,
  onClick,
  label,
  children,
}: {
  side: "left" | "right";
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "absolute top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white/90 transition-[color,background-color,scale] duration-[var(--dur-fast)] hover:bg-black/70 active:scale-[0.97]",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      {children}
    </button>
  );
}

function plural(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return "лист";
  if (d >= 2 && d <= 4 && (dd < 10 || dd >= 20)) return "листа";
  return "листов";
}
