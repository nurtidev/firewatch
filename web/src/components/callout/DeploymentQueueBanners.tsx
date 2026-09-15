"use client";

/**
 * Состояние очереди расстановки — над разделами выезда, а не внутри
 * «Расстановки»: без связи расстановка не теряется, но на пульте её пока не
 * видят, и молчать об этом нельзя — от этого зависит, доложит РТП по радио
 * или положится на схему. РТП, ушедший в «Хронологию», обязан видеть, что
 * позиции не ушли, что нужен повторный вход или что сервер что-то отверг.
 *
 * Рендерит баннеры фрагментом — родитель раскладывает их в свой стек.
 */
import { useRouter } from "next/navigation";
import { CloudOff, CloudUpload, KeyRound, Loader2, LogIn, ShieldAlert, WifiOff } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { POSITION_KIND_META } from "@/lib/dispatch";
import type { RejectedEntry } from "@/lib/deploymentQueue";
import type { DeploymentQueue } from "./useDeploymentQueue";

/** Подпись отвергнутой позиции: тип и место, а не «операция #3». Названия
 *  этажей в карточках уже человеческие («5-й этаж») — «этаж» не дописываем. */
function rejectedLabel(r: RejectedEntry, t: (ru: string) => string): string {
  const kind = r.kind ? t(POSITION_KIND_META[r.kind].label) : t("Позиция");
  const what = r.where ? `${kind} · ${r.where}` : kind;
  if (r.op === "patch") return `${t("Перемещение")}: ${what}`;
  if (r.op === "delete") return `${t("Снятие")}: ${what}`;
  return what;
}

export default function DeploymentQueueBanners({
  queue,
  showQueue,
}: {
  queue: DeploymentQueue;
  /** Очередь видна тому, кто ставит позиции, и на закрытом выезде, пока на
   *  устройстве что-то лежит (сервер досинхронизирует поставленное до
   *  закрытия). */
  showQueue: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const { online } = queue;

  return (
    <>
      {/* Кнопка нужна там, где navigator.onLine врёт: Wi-Fi точки есть,
          интернета за ней нет — в подземном паркинге это обычное дело. */}
      {showQueue && !online && (
        <Banner tone="warning" icon={WifiOff}>
          {queue.pending.length > 0
            ? t("Связи нет. Расстановка сохранена на устройстве ({n}) и уйдёт на пульт, когда связь появится.")
                .replace("{n}", String(queue.pending.length))
            : t("Связи нет. Расставляйте — позиции сохранятся на устройстве и уйдут при связи.")}
        </Banner>
      )}
      {/* 401 при отправке — не отказ расстановке: токен истёк за смену без
          связи. Очередь цела, и человек должен знать, что для отправки нужен
          вход, а не повтор нажатия «Отправить». */}
      {showQueue && queue.authRequired && queue.pending.length > 0 && (
        <Banner tone="warning" icon={KeyRound}>
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {t(
                "Нужен повторный вход. Расстановка ({n}) сохранена на устройстве и уйдёт после входа под этой же учётной записью.",
              ).replace("{n}", String(queue.pending.length))}
            </span>
            <Button size="sm" variant="secondary" onClick={() => router.push("/login")}>
              <LogIn className="h-4 w-4" aria-hidden />
              {t("Войти заново")}
            </Button>
          </span>
        </Banner>
      )}
      {/* 403 — у учётной записи нет прав на расстановку в этом выезде.
          Повторный вход тут не поможет, а повтор отправки даст тот же отказ,
          поэтому очередь сама не уходит. Кнопка — на случай, когда диспетчер
          уже выдал права. */}
      {showQueue && queue.forbidden && !queue.authRequired && queue.pending.length > 0 && (
        <Banner
          tone="warning"
          icon={ShieldAlert}
          title={t("Нет прав на расстановку в этом выезде — обратитесь к диспетчеру")}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {t("Расстановка ({n}) сохранена на устройстве и не потеряется.").replace(
                "{n}",
                String(queue.pending.length),
              )}
            </span>
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
          </span>
        </Banner>
      )}
      {showQueue &&
        online &&
        !queue.authRequired &&
        !queue.forbidden &&
        queue.pending.length > 0 && (
        <Banner tone="info" icon={CloudUpload}>
          <span className="flex flex-wrap items-center gap-2">
            <span>
              {t("Позиций ждёт отправки: {n}").replace("{n}", String(queue.pending.length))}
              {queue.retryReason ? ` — ${t(queue.retryReason)}` : ""}
            </span>
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
          </span>
        </Banner>
      )}

      {/* Отвергнутое сервером. Само не исчезает: расстановка, которую не
          приняли (например, поставленная уже после закрытия выезда), — это
          то, что РТП должен перенести в донесение руками, а не обнаружить
          пропажу через неделю на разборе. */}
      {queue.rejected.length > 0 && (
        <Banner
          tone="critical"
          icon={CloudOff}
          title={t("Не принято сервером: {n}").replace("{n}", String(queue.rejected.length))}
        >
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
          <Button size="sm" variant="secondary" className="mt-2" onClick={queue.dismissRejected}>
            {t("Понятно")}
          </Button>
        </Banner>
      )}
    </>
  );
}
