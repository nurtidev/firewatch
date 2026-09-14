"use client";

/**
 * Пометка «данные из офлайн-кэша» — один вид на пульте, на планшете и в
 * донесении.
 *
 * Service Worker отдаёт сохранённый ответ API, если сеть молчит дольше 4 с,
 * и помечает его заголовком `X-FW-Cached` (public/sw.js → lib/sw.ts
 * `cachedAtOf`). По списку выездов, боевому пакету и расстановке
 * распоряжаются силами: снимок, неотличимый от живых данных, опаснее пустого
 * экрана — по пустому хотя бы видно, что данных нет.
 *
 * Цвет не единственный сигнал: значок «нет связи» и время снимка в тексте.
 */

import type { ReactNode } from "react";
import { WifiOff } from "lucide-react";
import { Banner } from "@/components/ui";
import { intlLocale, useLocale, useT, type Locale } from "@/lib/i18n";

type Kind = "list" | "pack" | "deployment" | "report";

/** Ключи перевода (русский текст — ключ). `{time}` — время снимка. */
const MESSAGES: Record<Kind, { withTime: string; noTime: string }> = {
  list: {
    withTime: "Связи нет — список выездов от {time}. Новые выезды здесь могут не отображаться.",
    noTime: "Связи нет — показан сохранённый список выездов. Новые выезды здесь могут не отображаться.",
  },
  pack: {
    withTime: "Связи нет — показан сохранённый боевой пакет от {time}. Обстановка могла измениться.",
    noTime: "Связи нет — показан сохранённый боевой пакет. Обстановка могла измениться.",
  },
  deployment: {
    withTime:
      "Расстановка с пульта — по данным от {time}, связи нет. Изменения, сделанные на пульте позже, здесь не видны.",
    noTime:
      "Расстановка с пульта — по сохранённым данным, связи нет. Изменения, сделанные на пульте позже, здесь не видны.",
  },
  report: {
    withTime:
      "Донесение собрано из сохранённого снимка от {time}: сервер не ответил. На печати лист помечен как неподтверждённый.",
    noTime:
      "Донесение собрано из сохранённого снимка: сервер не ответил. На печати лист помечен как неподтверждённый.",
  },
};

/** «14:32» для сегодняшнего снимка, «13.09 14:32» — для более старого: время
 *  без даты у снимка прошлой смены читалось бы как сегодняшнее. */
function snapshotTime(iso: string, locale: Locale): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString(intlLocale(locale), {
    ...(sameDay ? {} : { day: "2-digit", month: "2-digit" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function StaleDataBanner({
  cachedAt,
  kind,
  className,
  children,
}: {
  /** null — данные живые, пометки нет; "" — снимок без времени; ISO — время снимка. */
  cachedAt: string | null;
  kind: Kind;
  className?: string;
  /** Действие под текстом — например, «Повторить». */
  children?: ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  if (cachedAt == null) return null;
  const time = cachedAt ? snapshotTime(cachedAt, locale) : null;
  const { withTime, noTime } = MESSAGES[kind];
  return (
    <Banner tone="warning" icon={WifiOff} className={className}>
      <span className="tabular">
        {time ? t(withTime).replace("{time}", time) : t(noTime)}
      </span>
      {children && <div className="mt-2">{children}</div>}
    </Banner>
  );
}
