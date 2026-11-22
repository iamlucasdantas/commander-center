"use client";

import { useMemo, useState } from "react";
import type { LogEntry } from "@/lib/state";

type LogFilter = "all" | "today" | "week" | "pending" | "completed" | "30d";

const ACTION_LABEL: Record<string, string> = {
  "manual-verify": "Manual verification",
  "dnd-automation": "DND automation",
  "dnd-revert": "DND reversal",
  "delete-unverified": "Deletion",
  "partner-separate": "Partner separation",
  manual: "Manual entry",
};

const DAY = 86_400_000;

function chicagoDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago",
  });
}

interface Props {
  initialEntries: LogEntry[];
  /** Conta fixa (página da conta): filtra as entradas e mostra o formulário de nova entrada. */
  slug?: string;
  /** Visão combinada (home): mostra o nome da conta em cada entrada. */
  showAccount?: boolean;
}

/**
 * LOG do painel (pedido do Lucas, 2026-11-22): entradas automáticas
 * das ações do painel (verificação manual, exclusão de não
 * verificados, separação Partner; as entradas "DND automation" são o
 * histórico da automação desligada em 2026-11-22 e as "DND reversal",
 * a reversão dela) + entradas manuais
 * dele (Log ou Tarefa, Pendente ou Concluída), tudo no armazenamento
 * interno (state.ts). Filtros: Hoje, Esta semana, Pendentes,
 * Concluídas, Últimos 30 dias e Tudo, estado do cliente, na hora.
 */
export default function LogPanel({ initialEntries, slug, showAccount }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>(initialEntries);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"log" | "task">("task");
  const [status, setStatus] = useState<"pending" | "completed">("pending");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const mine = useMemo(
    () => entries.filter((e) => !slug || e.slug === slug),
    [entries, slug],
  );

  const visible = useMemo(() => {
    const now = Date.now();
    const todayStr = chicagoDay(new Date(now).toISOString());
    return mine.filter((e) => {
      const t = new Date(e.at).getTime();
      switch (filter) {
        case "today": return chicagoDay(e.at) === todayStr;
        case "week": return now - t < 7 * DAY;
        case "30d": return now - t < 30 * DAY;
        case "pending": return e.status === "pending";
        case "completed": return e.status === "completed";
        default: return true;
      }
    });
  }, [mine, filter]);

  const options: Array<{ key: LogFilter; label: string }> = [
    { key: "today", label: "Today" },
    { key: "week", label: "This week" },
    { key: "pending", label: "Pending" },
    { key: "completed", label: "Completed" },
    { key: "30d", label: "Last 30 days" },
    { key: "all", label: "All" },
  ];

  async function addEntry() {
    if (!slug || !title.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, title: title.trim(), kind, status, detail: detail.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.entry) {
        setEntries((prev) => [data.entry as LogEntry, ...prev]);
        setTitle("");
        setDetail("");
        setMsg({ kind: "ok", text: "Entry saved to the panel log." });
      } else {
        setMsg({ kind: "error", text: data.error ?? "The entry could not be saved." });
      }
    } catch {
      setMsg({ kind: "error", text: "Network error. The entry was not saved." });
    }
    setBusy(false);
  }

  return (
    <div>
      {slug && (
        <div className="logform">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New log entry or task title"
            aria-label="Entry title"
          />
          <select value={kind} onChange={(e) => setKind(e.target.value as "log" | "task")} aria-label="Type">
            <option value="task">Task</option>
            <option value="log">Log</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as "pending" | "completed")} aria-label="Status">
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
          </select>
          <input
            type="text"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Detail (optional)"
            aria-label="Detail"
          />
          <button type="button" className="btn" disabled={busy || !title.trim()} onClick={addEntry}>
            {busy ? "Saving..." : "Add entry"}
          </button>
        </div>
      )}
      {msg && (
        <p className={msg.kind === "ok" ? "resultok" : "resultbad"} style={{ fontSize: 13.5, margin: "8px 0" }}>{msg.text}</p>
      )}

      <div className="leadfilter" role="tablist" aria-label="Filter log entries">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={filter === o.key}
            className={`lfbtn${filter === o.key ? " on" : ""}`}
            onClick={() => setFilter(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {visible.length ? (
        visible.map((e) => (
          <div className="logentry" key={e.id}>
            <span>
              <b>{e.title}</b>
              <small>
                {fmtWhen(e.at)}
                {showAccount && e.account ? ` · ${e.account}` : ""}
                {" · "}{ACTION_LABEL[e.action] ?? e.action}
              </small>
              {e.detail && <span className="logdetail">{e.detail}</span>}
            </span>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <span className="tag email">{e.kind === "task" ? "task" : "log"}</span>
              {e.status === "pending"
                ? <span className="tag unread">pending</span>
                : <span className="tag">completed</span>}
            </span>
          </div>
        ))
      ) : (
        <p style={{ fontSize: 14, color: "#B7A69B", padding: "8px 0" }}>No entries in this view yet.</p>
      )}
    </div>
  );
}
