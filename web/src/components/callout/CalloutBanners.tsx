"use client";

/**
 * Баннеры выезда — над вкладками, одним стеком по приоритету: РТП, ушедший в
 * «Хронологию», обязан видеть, что сервер что-то отверг, что последнее
 * действие не сохранилось, что нужен повторный вход или что данные — снимок.
 *
 * Без связи их набирается несколько, и каждый многострочный сдвигал бы
 * липкую ленту вкладок вниз, под палец. Поэтому каждый — одна строка:
 * суть и действие, длинное объяснение — за «Подробнее».
 *
 * Порядок: то, что уже потеряно или не сохранилось (отказ сервера, ошибка
 * действия) → то, что требует действия человека (вход, права) → что данные
 * не живые (снимок пакета, нет связи) → справка (очередь уходит).
 */
import { useRouter } from "next/navigation";
import { CloudOff, CloudUpload, KeyRound, Loader2, LogIn, ShieldAlert, WifiOff } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import StaleDataBanner from "@/components/StaleDataBanner";
import { useT } from "@/lib/i18n";
import { POSITION_KIND_META } from "@/lib/dispatch";
import type { RejectedEntry } from "@/lib/deploymentQueue";
import type { DeploymentQueue } from "./useDeploymentQueue";

/** Ошибка последнего действия и раздел, где оно было («Наряд сил», …). */
export type ActionError = { section: string; message: string };

/** Подпись отвергнутой позиции: тип и место, а не «операция #3». Названия
 *  этажей в карточках уже человеческие («5-й этаж») — «этаж» не дописываем. */
function rejectedLabel(r: RejectedEntry, t: (ru: string) => string): string {
  const kind = r.kind ? t(POSITION_KIND_META[r.kind].label) : t("Позиция");
  const what = r.where ? `${kind} · ${r.where}` : kind;
  if (r.op === "patch") return `${t("Перемещение")}: ${what}`;
  if (r.op === "delete") return `${t("Снятие")}: ${what}`;
  return what;
}

export default function CalloutBanners({
  queue,
  showQueue,
  cachedAt,
  error,
  onDismissError,
}: {
  queue: DeploymentQueue;
  /** Очередь видна тому, кто ставит позиции, и на закрытом выезде, пока на
   *  устройстве что-то лежит (сервер досинхронизирует поставленное до
   *  закрытия). */
  showQueue: boolean;
  /** Пакет отдан офлайн-кэшем (см. useCalloutPack). */
  cachedAt: string | null;
  error: ActionError | null;
  onDismissError: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { online } = queue;
  const n = queue.pending.length;

  const sendButton = (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => void queue.flush(true)}
      disabled={queue.syncing}
    >
      {queue.syncing ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <CloudUpload className="h-4 w-4" aria-hidden />
      )}
      {t("Отправить")}
    </Button>
  );

  return (
    <>
      {/* Отвергнутое сервером. Само не исчезает: расстановка, которую не
          приняли (например, поставленная уже после закрытия выезда), — это
          то, что РТП должен перенести в донесение руками, а не обнаружить
          пропажу через неделю на разборе. */}
      {queue.rejected.length > 0 && (
        <Banner
          tone="critical"
          icon={CloudOff}
          title={t("Не принято сервером: {n}").replace("{n}", String(queue.rejected.length))}
          details={
            <ul className="space-y-0.5">
              {queue.rejected.slice(0, 6).map((r) => (
                <li key={r.key}>
                  {rejectedLabel(r, t)} — {t(r.reason)}
                </li>
              ))}
              {queue.rejected.length > 6 && (
                <li className="text-faint">
                  {t("и ещё {n}").replace("{n}", String(queue.rejected.length - 6))}
                </li>
              )}
            </ul>
          }
          action={
            <Button size="sm" variant="secondary" onClick={queue.dismissRejected}>
              {t("Понятно")}
            </Button>
          }
        />
      )}

      {/* Последнее действие не сохранилось — с разделом, чтобы с другой
          вкладки было понятно, что именно повторить. */}
      {error && (
        <Banner tone="critical" onDismiss={onDismissError}>
          <span className="font-semibold text-fg">{error.section}:</span> {error.message}
        </Banner>
      )}

      {/* 401 при отправке — не отказ расстановке: токен истёк за смену без
          связи. Очередь цела, и человек должен знать, что для отправки нужен
          вход, а не повтор нажатия «Отправить». */}
      {showQueue && queue.authRequired && n > 0 && (
        <Banner
          tone="warning"
          icon={KeyRound}
          title={t("Нужен повторный вход — расстановка на устройстве: {n}").replace("{n}", String(n))}
          details={t(
            "Нужен повторный вход. Расстановка ({n}) сохранена на устройстве и уйдёт после входа под этой же учётной записью.",
          ).replace("{n}", String(n))}
          action={
            <Button size="sm" variant="secondary" onClick={() => router.push("/login")}>
              <LogIn className="h-4 w-4" aria-hidden />
              {t("Войти заново")}
            </Button>
          }
        />
      )}

      {/* 403 — у учётной записи нет прав на расстановку в этом выезде.
          Повторный вход тут не поможет, а повтор отправки даст тот же отказ,
          поэтому очередь сама не уходит. Кнопка — на случай, когда диспетчер
          уже выдал права. */}
      {showQueue && queue.forbidden && !queue.authRequired && n > 0 && (
        <Banner
          tone="warning"
          icon={ShieldAlert}
          title={t("Нет прав на расстановку в этом выезде — обратитесь к диспетчеру")}
          details={t("Расстановка ({n}) сохранена на устройстве и не потеряется.").replace(
            "{n}",
            String(n),
          )}
          action={sendButton}
        />
      )}

      {/* Пакет отдан офлайн-кэшем: гидрант мог сломаться, а проезд
          перекрыть уже после того, как снимок был снят. Молчать об
          этом нельзя — по пакету распоряжаются силами. */}
      <StaleDataBanner cachedAt={cachedAt} kind="pack" />

      {/* Без связи расстановка не теряется, но на пульте её пока не видят —
          от этого зависит, доложит РТП по радио или положится на схему. */}
      {showQueue && !online && (
        n > 0 ? (
          <Banner
            tone="warning"
            icon={WifiOff}
            title={t("Связи нет — позиций на устройстве: {n}").replace("{n}", String(n))}
            details={t(
              "Связи нет. Расстановка сохранена на устройстве ({n}) и уйдёт на пульт, когда связь появится.",
            ).replace("{n}", String(n))}
          />
        ) : (
          <Banner tone="warning" icon={WifiOff}>
            {t("Связи нет. Расставляйте — позиции сохранятся на устройстве и уйдут при связи.")}
          </Banner>
        )
      )}

      {/* Кнопка нужна там, где navigator.onLine врёт: Wi-Fi точки есть,
          интернета за ней нет — в подземном паркинге это обычное дело. */}
      {showQueue && online && !queue.authRequired && !queue.forbidden && n > 0 && (
        <Banner
          tone="info"
          icon={CloudUpload}
          title={t("Позиций ждёт отправки: {n}").replace("{n}", String(n))}
          details={queue.retryReason ? t(queue.retryReason) : undefined}
          action={sendButton}
        />
      )}
    </>
  );
}
