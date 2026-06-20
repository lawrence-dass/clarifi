"use client";

import { useRef, useState } from "react";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/button";
import { type NLQueryResponse, useNLQuery } from "./query.hooks";

interface Turn {
  question: string;
  response?: NLQueryResponse;
  error?: unknown;
}

export function QueryChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const query = useNLQuery();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || query.isPending) return;

    const turnIndex = turns.length;
    setTurns((prev) => [...prev, { question: q }]);
    setQuestion("");

    try {
      const response = await query.mutateAsync(q);
      setTurns((prev) =>
        prev.map((t, i) => (i === turnIndex ? { ...t, response } : t)),
      );
    } catch (err) {
      setTurns((prev) =>
        prev.map((t, i) => (i === turnIndex ? { ...t, error: err } : t)),
      );
    }

    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-6">
      {turns.length === 0 ? (
        <div className="rounded border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm font-medium text-text">Ask a question about your finances</p>
          <p className="mt-1 text-xs text-text-muted">
            e.g. "How much did I spend on food last month?" or "What were my top 5 merchants in May?"
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {turns.map((turn, i) => (
            <TurnCard key={i} turn={turn} />
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about your spending…"
          className="h-10 flex-1 rounded-sm border border-border bg-surface px-3 text-sm text-text placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-primary"
          disabled={query.isPending}
          autoFocus
        />
        <Button type="submit" disabled={query.isPending || !question.trim()}>
          {query.isPending ? "Thinking…" : "Ask"}
        </Button>
      </form>
    </div>
  );
}

function TurnCard({ turn }: { turn: Turn }) {
  return (
    <div className="space-y-3">
      {/* Question bubble */}
      <div className="flex justify-end">
        <div className="max-w-prose rounded-md bg-primary px-4 py-2 text-sm text-white">
          {turn.question}
        </div>
      </div>

      {/* Answer */}
      {turn.error ? (
        <div className="rounded border border-border bg-surface px-4 py-3">
          <ErrorState error={turn.error} />
        </div>
      ) : turn.response ? (
        <div className="rounded border border-border bg-surface px-5 py-4 space-y-4">
          {/* Interpretation — quiet muted caption */}
          <p className="text-xs text-text-muted italic">{turn.response.interpretation}</p>
          <QueryResult response={turn.response} />
        </div>
      ) : (
        <div className="rounded border border-border bg-surface px-5 py-4">
          <p className="text-xs text-text-muted animate-pulse">Analysing…</p>
        </div>
      )}
    </div>
  );
}

function QueryResult({ response }: { response: NLQueryResponse }) {
  const { rows, metric, dimensions } = response;

  if (!rows.length) {
    return <p className="text-sm text-text-muted">No data found for this query.</p>;
  }

  // Scalar result — single row, no dimensions
  if (dimensions.length === 0 && rows.length === 1) {
    const row = rows[0]!;
    const value = row[metric];
    return (
      <div className="py-2">
        <p className="label-micro mb-1">{metricLabel(metric)}</p>
        <p className="text-kpi text-text tabular-nums">{formatValue(value)}</p>
      </div>
    );
  }

  // Table result
  const cols = [...dimensions, metric];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {cols.map((col) => (
              <th
                key={col}
                className={`label-micro py-2 ${col === metric ? "text-right" : "text-left"}`}
              >
                {metricLabel(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={i}>
              {cols.map((col) => (
                <td
                  key={col}
                  className={`py-2 ${col === metric ? "text-right tabular-nums font-medium text-text" : "text-text-muted"}`}
                >
                  {formatValue(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function metricLabel(key: string): string {
  return key.replace(/_/g, " ");
}

function formatValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}
