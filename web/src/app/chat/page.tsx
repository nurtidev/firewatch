"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Send,
  Code2,
  AlertOctagon,
  ChevronDown,
  ChevronUp,
  Database,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { apiFetch } from "@/lib/auth";
import { Card, SectionLabel, Button, Input } from "@/components/ui";
import { cn } from "@/lib/cn";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type Assistant = {
  role: "assistant";
  answer: string;
  intent?: string;
  sql?: string;
  columns?: string[];
  rows?: (string | number | null)[][];
  row_count?: number;
  error?: string;
};

type Message = { role: "user"; text: string } | Assistant;

/* ─── Suggestions ─────────────────────────────────────────────────────────── */

const SUGGESTIONS = [
  "Сколько всего неисправных гидрантов?",
  "Топ-10 зданий с самым высоким риском",
  "Сколько зданий с высоким риском в каждом районе?",
  "Средний риск по типам зданий",
];

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setLoading(true);
    try {
      const res = await apiFetch(`/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            answer: "",
            error: (data as { detail?: string }).detail || "Ошибка",
          },
        ]);
      } else {
        setMessages((m) => [...m, { role: "assistant", ...data }]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", answer: "", error: "Сеть недоступна" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex h-full max-w-3xl flex-col p-5 sm:p-7">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-fg">
              ИИ-аналитик
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              Вопрос на естественном языке → ответ строго из данных ДЧС
            </p>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <span className="text-xs text-muted">Аналитик</span>
          </div>
        </div>

        {/* Message scroll area */}
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Empty state / suggestions */}
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-10 gap-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2">
                  <Sparkles className="h-5 w-5 text-accent" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-fg">FireWatch · Аналитик</p>
                  <p className="mt-1 text-xs text-faint max-w-sm">
                    Задайте вопрос обычным языком — система сформирует SQL-запрос и вернёт данные ДЧС
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-muted",
                        "transition-colors duration-[var(--dur-fast)] hover:border-border-strong hover:bg-surface-3 hover:text-fg",
                        "focus-visible:outline-accent",
                      )}
                    >
                      <Sparkles className="h-3 w-3 text-accent" />
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <UserBubble key={i} text={m.text} />
              ) : (
                <AssistantBubble key={i} m={m} />
              ),
            )}

            {/* Typing indicator */}
            {loading && <TypingIndicator />}

            <div ref={bottomRef} />
          </div>
        </Card>

        {/* Input row */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="mt-3 flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Спросите про данные ДЧС…"
            className="flex-1"
            disabled={loading}
            aria-label="Вопрос аналитику"
          />
          <Button
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="Отправить"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </AppShell>
  );
}

/* ─── User bubble ─────────────────────────────────────────────────────────── */

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-lg rounded-tr-sm border border-border bg-surface-3 px-3 py-2 text-sm text-fg">
        {text}
      </div>
    </div>
  );
}

/* ─── Assistant bubble ────────────────────────────────────────────────────── */

function AssistantBubble({ m }: { m: Assistant }) {
  const [showSql, setShowSql] = useState(false);

  if (m.error) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[90%] rounded-lg rounded-tl-sm border border-critical/40 bg-critical-bg px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertOctagon className="h-3.5 w-3.5 shrink-0 text-critical" />
            <SectionLabel className="text-critical">FireWatch · Аналитик</SectionLabel>
          </div>
          <p className="mt-2 text-sm text-critical">{m.error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start fw-fade-in">
      <div className="max-w-[90%] space-y-3 rounded-lg rounded-tl-sm border border-border bg-surface-2 px-4 py-3">
        {/* Label */}
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-accent" />
          <SectionLabel className="text-accent">FireWatch · Аналитик</SectionLabel>
        </div>

        {/* Answer (markdown-aware; the raw pipe-table is dropped when we have
            a structured table to render below) */}
        {m.answer && (
          <AnswerMarkdown
            text={m.answer}
            stripTables={!!(m.rows && m.rows.length && m.columns)}
          />
        )}

        {/* Data table */}
        {m.rows && m.rows.length > 0 && m.columns && (
          <DataTable columns={m.columns} rows={m.rows} rowCount={m.row_count} />
        )}

        {/* SQL toggle */}
        {m.sql && (
          <div>
            <button
              onClick={() => setShowSql((s) => !s)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-faint",
                "transition-colors duration-[var(--dur-fast)] hover:bg-surface-3 hover:text-muted",
              )}
              aria-expanded={showSql}
            >
              <Code2 className="h-3 w-3" />
              {showSql ? "Скрыть SQL" : "Источник · SQL"}
              {m.row_count != null && (
                <span className="tabular text-faint">· {m.row_count} стр.</span>
              )}
              {showSql ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
            {showSql && (
              <pre className="mt-2 overflow-x-auto rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-muted">
                {m.sql}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Answer markdown (minimal, safe) ─────────────────────────────────────── */

/** Render inline **bold** spans; everything else is plain text. */
function renderInline(text: string, keyPrefix: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    /^\*\*[^*]+\*\*$/.test(part) ? (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold text-fg">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    ),
  );
}

/**
 * Tiny markdown renderer for the analyst answer: headings, **bold**, and
 * bullet lists. Markdown tables are dropped when `stripTables` is set because
 * the structured DataTable below already shows that data.
 */
function AnswerMarkdown({
  text,
  stripTables,
}: {
  text: string;
  stripTables?: boolean;
}) {
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  let bullets: string[] = [];

  const flushPara = (k: string) => {
    if (para.length) {
      blocks.push(
        <p key={k} className="text-sm leading-relaxed text-muted">
          {renderInline(para.join(" "), k)}
        </p>,
      );
      para = [];
    }
  };
  const flushBullets = (k: string) => {
    if (bullets.length) {
      blocks.push(
        <ul key={k} className="space-y-1">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-muted">
              <span className="mt-px text-accent">•</span>
              <span>{renderInline(b, `${k}-${i}`)}</span>
            </li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };

  text.split("\n").forEach((raw, idx) => {
    const line = raw.trim();
    const k = `blk-${idx}`;
    // Drop markdown table rows + separator lines (structured table covers them).
    if (stripTables && /^\|.*\|?$/.test(line)) return;
    if (/^\|?[\s:|-]{3,}\|?$/.test(line) && line.includes("-")) return;
    if (!line) {
      flushPara(k);
      flushBullets(k);
      return;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      flushPara(k);
      flushBullets(k);
      blocks.push(
        <div key={k} className="text-sm font-semibold text-fg">
          {renderInline(heading[1], k)}
        </div>,
      );
      return;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushPara(k);
      bullets.push(bullet[1]);
      return;
    }
    flushBullets(k);
    para.push(line);
  });
  flushPara("end-p");
  flushBullets("end-b");

  return <div className="space-y-2">{blocks}</div>;
}

/* ─── Data table ──────────────────────────────────────────────────────────── */

function DataTable({
  columns,
  rows,
  rowCount,
}: {
  columns: string[];
  rows: (string | number | null)[][];
  rowCount?: number;
}) {
  const displayed = rows.slice(0, 15);
  const hidden = (rowCount ?? rows.length) - displayed.length;

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <Database className="h-3.5 w-3.5 text-faint" />
        <SectionLabel>
          {rowCount != null ? `${rowCount} строк` : `${rows.length} строк`}
        </SectionLabel>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" role="table">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              {columns.map((c) => (
                <th
                  key={c}
                  className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted"
                  scope="col"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map((row, ri) => (
              <tr
                key={ri}
                className={cn(
                  "border-b border-border last:border-0",
                  ri % 2 === 1 && "bg-surface/50",
                )}
              >
                {row.map((cell, ci) => (
                  <td key={ci} className="whitespace-nowrap px-3 py-1.5 tabular text-fg">
                    {cell == null ? (
                      <span className="text-faint">—</span>
                    ) : (
                      String(cell)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && (
        <div className="border-t border-border px-3 py-2 text-xs text-faint">
          + ещё {hidden} строк не показаны
        </div>
      )}
    </div>
  );
}

/* ─── Typing indicator ───────────────────────────────────────────────────── */

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-2 rounded-lg rounded-tl-sm border border-border bg-surface-2 px-4 py-3">
        <Sparkles className="h-3 w-3 text-accent" />
        <SectionLabel className="text-accent">FireWatch · Аналитик</SectionLabel>
        <span className="flex items-center gap-0.5 ml-1" aria-label="печатает…">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-accent"
              style={{
                animation: `fw-pulse 1.2s var(--ease) ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}
