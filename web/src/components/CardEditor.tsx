"use client";

/**
 * Редактор полей оперативной карточки: правка, история версий, согласование.
 *
 * Карточка ПТП — документ, по которому караул работает на пожаре, поэтому
 * редактор устроен вокруг трёх правил:
 *
 *   1. Правка утверждённой карточки снимает утверждение. Изменение не попадает
 *      в боевой пакет молча — караул видит, что документ ещё не подписан.
 *   2. Подписывает не автор. Инспектор правит и отправляет на согласование,
 *      начальник отдела утверждает — то же разделение, что у предписаний.
 *   3. Предыдущее состояние сохраняется всегда. Откат берёт снимок ревизии
 *      целиком, и сам записывается в историю: иначе состояние, к которому
 *      откатились, исчезло бы из журнала.
 *
 * Телефоны в поле «Контакты» маскируются на сервере и при ручном вводе —
 * редактор не является обходом маскирования ПДн.
 */
import { useState } from "react";
import {
  Pencil,
  History,
  Check,
  X,
  Send,
  RotateCcw,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import {
  Card,
  SectionLabel,
  Button,
  Banner,
  StatusChip,
  Input,
  Textarea,
  Field,
} from "@/components/ui";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { SEVERITY, type SeverityMeta } from "@/lib/risk";
import { apiFetch } from "@/lib/auth";

export type CardReviewStatus = "draft" | "on_review" | "approved";

export const REVIEW_STATUS_META: Record<
  CardReviewStatus,
  { label: string; severity: SeverityMeta; hint: string }
> = {
  draft: {
    label: "Черновик",
    severity: SEVERITY.elevated,
    hint: "Карточка изменена и не утверждена — караулу показывается как неподписанная.",
  },
  on_review: {
    label: "На согласовании",
    severity: SEVERITY.high,
    hint: "Отправлена начальнику отдела на утверждение.",
  },
  approved: {
    label: "Утверждена",
    severity: SEVERITY.normal,
    hint: "Документ подписан и действует.",
  },
};

export type CardRevision = {
  id: number;
  changed_fields: string[];
  note: string | null;
  author: string;
  created_at: string;
};

/** Поля, которые вводятся в несколько строк, — остальные однострочные. */
const MULTILINE = new Set([
  "construction",
  "fire_systems",
  "water_source",
  "evacuation",
  "notes",
  "contacts",
]);

export default function CardEditor({
  cardId,
  fields,
  values,
  reviewStatus,
  updatedBy,
  updatedAt,
  approvedBy,
  canEdit,
  canApprove,
  onSaved,
  className,
}: {
  cardId: number;
  /** Манифест «ключ → подпись» — тот же порядок, что и в просмотре. */
  fields: [string, string][];
  values: Record<string, unknown>;
  reviewStatus: CardReviewStatus;
  updatedBy: string | null;
  updatedAt: string | null;
  approvedBy: string | null;
  canEdit: boolean;
  canApprove: boolean;
  onSaved: () => void;
  className?: string;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<CardRevision[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const meta = REVIEW_STATUS_META[reviewStatus] ?? REVIEW_STATUS_META.draft;

  const startEdit = () => {
    setDraft(
      Object.fromEntries(
        fields
          .filter(([key]) => isScalar(values[key]))
          .map(([key]) => [key, values[key] == null ? "" : String(values[key])]),
      ),
    );
    setEditing(true);
    setError(null);
  };

  const run = async (key: string, fn: () => Promise<Response>) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) {
        let msg = t("Не удалось сохранить изменения");
        try {
          const body = await r.json();
          if (typeof body?.detail === "string") msg = body.detail;
        } catch {
          /* тело не JSON — остаётся общий текст */
        }
        throw new Error(msg);
      }
      onSaved();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Не удалось сохранить изменения"));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    // Отправляем только изменённое: PATCH пишет ревизию по фактическому диффу,
    // и полный набор полей раздул бы историю пустыми правками.
    const changed: Record<string, string> = {};
    for (const [key] of editableFields) {
      const before = values[key] == null ? "" : String(values[key]);
      if ((draft[key] ?? "") !== before) changed[key] = draft[key] ?? "";
    }
    if (Object.keys(changed).length === 0) {
      setEditing(false);
      return;
    }
    const ok = await run("save", () =>
      apiFetch(`/cards/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: changed }),
      }),
    );
    if (ok) {
      setEditing(false);
      setRevisions(null);
    }
  };

  const review = (action: "submit" | "approve" | "reject") =>
    run(action, () =>
      apiFetch(`/cards/${cardId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }),
    );

  const loadHistory = async () => {
    setShowHistory((v) => !v);
    if (revisions !== null) return;
    try {
      const r = await apiFetch(`/cards/${cardId}/revisions`);
      if (r.ok) setRevisions(await r.json());
    } catch {
      setError(t("Не удалось загрузить историю правок"));
    }
  };

  const restore = async (revisionId: number) => {
    const ok = await run(`restore-${revisionId}`, () =>
      apiFetch(`/cards/${cardId}/revisions/${revisionId}/restore`, { method: "POST" }),
    );
    if (ok) setRevisions(null);
  };

  const labelOf = (key: string) => fields.find(([k]) => k === key)?.[1] ?? key;

  /** В структурной карточке те же ключи хранят структуру, а не текст: contacts
   *  — массив {роль, имя, телефон}. Такое поле нельзя ни показать через
   *  String() (выйдет «[object Object]»), ни отдать в текстовый инпут: запись
   *  строкой разрушила бы документ, и сервер её отклонит 422-м. Правим только
   *  скаляры, структурные поля показываем на своём экране. */
  const isScalar = (v: unknown) =>
    v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

  const editableFields = fields.filter(([key]) => isScalar(values[key]));
  const filled = editableFields.filter(
    ([key]) => values[key] != null && values[key] !== "",
  );
  const structuredCount = fields.length - editableFields.length;

  return (
    <Card className={cn("p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel>{t("Карточка объекта")}</SectionLabel>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusChip severity={meta.severity} label={t(meta.label)} />
            {approvedBy && reviewStatus === "approved" && (
              <span className="text-xs text-faint">
                <ShieldCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                {t("утвердил")} {approvedBy}
              </span>
            )}
            {updatedBy && (
              <span className="text-xs text-faint">
                {t("правка")}: {updatedBy}
                {updatedAt ? ` · ${new Date(updatedAt).toLocaleDateString("ru")}` : ""}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-faint">{t(meta.hint)}</p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={loadHistory}>
            <History className="h-4 w-4" aria-hidden />
            {t("История")}
          </Button>
          {canEdit && !editing && (
            <Button size="sm" variant="secondary" onClick={startEdit}>
              <Pencil className="h-4 w-4" aria-hidden />
              {t("Редактировать")}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Banner tone="critical" className="mt-3">
          {error}
        </Banner>
      )}

      {/* ─── Согласование ─── */}
      {canEdit && !editing && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          {reviewStatus === "draft" && (
            <Button size="sm" onClick={() => review("submit")} disabled={busy === "submit"}>
              {busy === "submit" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden />
              )}
              {t("На согласование")}
            </Button>
          )}
          {reviewStatus === "on_review" && canApprove && (
            <>
              <Button
                size="sm"
                variant="success"
                onClick={() => review("approve")}
                disabled={busy === "approve"}
              >
                <Check className="h-4 w-4" aria-hidden />
                {t("Утвердить")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => review("reject")}
                disabled={busy === "reject"}
              >
                <X className="h-4 w-4" aria-hidden />
                {t("Вернуть на доработку")}
              </Button>
            </>
          )}
          {reviewStatus === "on_review" && !canApprove && (
            <p className="text-xs text-muted">
              {t("Ожидает утверждения начальником отдела.")}
            </p>
          )}
        </div>
      )}

      {/* ─── Поля ─── */}
      {editing ? (
        <div className="mt-4 space-y-3">
          {editableFields.map(([key, label]) => (
            <Field key={key} label={t(label)}>
              {MULTILINE.has(key) ? (
                <Textarea
                  rows={key === "notes" || key === "construction" ? 3 : 2}
                  value={draft[key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                />
              ) : (
                <Input
                  value={draft[key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                />
              )}
            </Field>
          ))}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t("Отмена")}
            </Button>
            <Button onClick={save} disabled={busy === "save"}>
              {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t("Сохранить")}
            </Button>
          </div>
          <p className="text-xs text-faint">
            {t("Телефоны в поле «Контакты» маскируются автоматически — это требование по ПДн.")}
            {structuredCount > 0 &&
              ` ${t("Поля, заполненные структурой (контакты, блоки, расчёт), правятся в самом плане, а не текстом.")}`}
          </p>
        </div>
      ) : (
        <dl className="mt-4 space-y-2">
          {filled.map(([key, label]) => (
            <div key={key} className="flex gap-3 text-sm">
              <dt className="w-36 shrink-0 text-faint">{t(label)}</dt>
              <dd className="min-w-0 whitespace-pre-wrap text-fg">{String(values[key])}</dd>
            </div>
          ))}
          {filled.length === 0 && (
            <p className="text-sm text-faint">{t("Поля не заполнены")}</p>
          )}
        </dl>
      )}

      {/* ─── История правок ─── */}
      {showHistory && (
        <div className="mt-4 border-t border-border pt-3">
          <SectionLabel>{t("История правок")}</SectionLabel>
          {revisions === null ? (
            <p className="mt-2 text-sm text-muted">{t("Загрузка…")}</p>
          ) : revisions.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              {t("Карточка не изменялась с момента распознавания.")}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {revisions.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-fg">
                      {r.changed_fields.length
                        ? r.changed_fields.map((f) => t(labelOf(f))).join(", ")
                        : t("без изменения полей")}
                    </div>
                    <div className="mt-0.5 text-xs text-faint">
                      {r.author} ·{" "}
                      <span className="tabular">
                        {new Date(r.created_at).toLocaleString("ru", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {r.note ? ` · ${r.note}` : ""}
                    </div>
                  </div>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => restore(r.id)}
                      disabled={busy === `restore-${r.id}`}
                      aria-label={`${t("Откатить к версии")} #${r.id}`}
                    >
                      {busy === `restore-${r.id}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <RotateCcw className="h-4 w-4" aria-hidden />
                      )}
                      {t("Откатить")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className={cn("mt-2 text-xs text-faint")}>
            {t("Откат восстанавливает состояние на момент правки и сам записывается в историю.")}
          </p>
        </div>
      )}
    </Card>
  );
}
