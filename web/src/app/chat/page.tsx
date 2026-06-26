"use client";

import { useState } from "react";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

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

const SUGGESTIONS = [
  "Сколько всего неисправных гидрантов?",
  "Топ-10 зданий с самым высоким риском",
  "Сколько зданий с высоким риском в каждом районе?",
  "Средний риск по типам зданий",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function send(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((m) => [
          ...m,
          { role: "assistant", answer: "", error: data.detail || "Ошибка" },
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
    <main className="mx-auto flex h-screen max-w-3xl flex-col p-6">
      <div className="mb-3">
        <Link href="/" className="text-xs tracking-widest text-neutral-500">
          ← FIREWATCH
        </Link>
        <h1 className="mt-1 text-xl font-bold">ИИ-аналитик · диалог с данными</h1>
        <p className="text-xs text-neutral-400">
          Вопрос обычным языком → ответ строго из данных ДЧС · источник в каждом
          ответе
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-950 p-4">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-900"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-lg bg-neutral-800 px-3 py-2 text-sm">
                {m.text}
              </div>
            </div>
          ) : (
            <AssistantBubble key={i} m={m} />
          )
        )}

        {loading && (
          <p className="text-xs tracking-widest text-[#ff5a1f]">
            FIREWATCH · АНАЛИТИК печатает…
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Спросите про данные ДЧС…"
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md px-5 py-2.5 text-sm font-medium text-black disabled:opacity-50"
          style={{ background: "var(--fw-accent)" }}
        >
          →
        </button>
      </form>
    </main>
  );
}

function AssistantBubble({ m }: { m: Assistant }) {
  const [showSql, setShowSql] = useState(false);
  if (m.error) {
    return (
      <div className="text-sm text-red-400">
        <span className="text-xs tracking-widest text-[#ff5a1f]">
          FIREWATCH · АНАЛИТИК
        </span>
        <p className="mt-1">{m.error}</p>
      </div>
    );
  }
  return (
    <div className="text-sm">
      <span className="text-xs tracking-widest text-[#ff5a1f]">
        FIREWATCH · АНАЛИТИК
      </span>
      <p className="mt-1 whitespace-pre-wrap text-neutral-100">{m.answer}</p>

      {m.rows && m.rows.length > 0 && m.columns && (
        <div className="mt-3 overflow-x-auto rounded border border-neutral-800">
          <table className="w-full text-xs">
            <thead className="bg-neutral-900 text-neutral-400">
              <tr>
                {m.columns.map((c) => (
                  <th key={c} className="px-2 py-1.5 text-left font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.rows.slice(0, 15).map((row, ri) => (
                <tr key={ri} className="border-t border-neutral-800">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2 py-1.5 text-neutral-200">
                      {cell == null ? "—" : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {m.sql && (
        <div className="mt-2">
          <button
            onClick={() => setShowSql((s) => !s)}
            className="text-[11px] tracking-widest text-neutral-500 hover:text-neutral-300"
          >
            {showSql ? "СКРЫТЬ ИСТОЧНИК" : "ИСТОЧНИК · SQL"}
            {m.row_count != null ? ` · ${m.row_count} строк` : ""}
          </button>
          {showSql && (
            <pre className="mt-1 overflow-x-auto rounded bg-black/60 p-2 text-[11px] text-neutral-400">
              {m.sql}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
