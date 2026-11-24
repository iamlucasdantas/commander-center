"use client";

import { useMemo, useState } from "react";

export interface LogGroup {
  key: string;
  at: string; // ISO da entrada mais recente do grupo
  minuteLabel: string; // "Nov 22, 03:58 PM" em Chicago
  actionLabel: string;
  account: string;
  title: string;
  count: number; // entradas agrupadas (a gravação triplicada vira ×3 aqui)
  kind: string;
  status: string;
  details: string[]; // detalhes de cada entrada (nomes só aparecem ao expandir)
}

type LogFilter = "all" | "today" | "week" | "pending" | "completed" | "30d";
const DAY = 86_400_000;

function chicagoDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

/**
 * Log do /v2 AGRUPADO (spec 2026-11-24, seção 4): uma linha por
 * (tipo de ação + minuto + execução), com a contagem por conta e os
 * nomes só ao expandir. É uma transformação de LEITURA sobre as
 * entradas que já existem: nada é apagado nem regravado, e a versão
 * atual do log continua como está. Os filtros são os mesmos da
 * versão atual (Today, This week, Pending, Completed, 30d, All).
 */
export default function GroupedLog({ groups }: { groups: LogGroup[] }) {
  const [filter, setFilter] = useState<LogFilter>("all");
  const [open, setOpen] = useState<string | null>(null);

  const visible = useMemo(() => {
    const now = Date.now();
    const todayStr = chicagoDay(new Date(now).toISOString());
    return groups.filter((g) => {
      const t = new Date(g.at).getTime();
      switch (filter) {
        case "today": return chicagoDay(g.at) === todayStr;
        case "week": return now - t < 7 * DAY;
        case "30d": return now - t < 30 * DAY;
        case "pending": return g.status === "pending";
        case "completed": return g.status === "completed";
        default: return true;
      }
    });
  }, [groups, filter]);

  const options: Array<{ key: LogFilter; label: string }> = [
    { key: "today", label: "Today" },
    { key: "week", label: "This week" },
    { key: "pending", label: "Pending" },
    { key: "completed", label: "Completed" },
    { key: "30d", label: "Last 30 days" },
    { key: "all", label: "All" },
  ];

  return (
    <div>
      <div className="leadfilter" role="tablist" aria-label="Filter log groups">
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

      {visible.length ? visible.map((g) => (
        <div className="v2-logrow" key={g.key}>
          <div className="v2-logmain">
            <b>{g.title}</b>
            {g.count > 1 && <span className="v2-count">×{g.count} entries grouped</span>}
            <span style={{ color: "#B7A69B", fontSize: 12.5 }}>
              {g.minuteLabel} · {g.account} · {g.actionLabel}
            </span>
            <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
              <span className="tag email">{g.kind === "task" ? "task" : "log"}</span>
              {g.status === "pending" ? <span className="tag unread">pending</span> : <span className="tag">completed</span>}
            </span>
          </div>
          {g.details.length > 0 && (
            <>
              <button type="button" className="v2-expand" onClick={() => setOpen(open === g.key ? null : g.key)}>
                {open === g.key ? "Hide details" : `Show details (${g.details.length})`}
              </button>
              {open === g.key && (
                <div className="v2-logdetail">{g.details.join("\n")}</div>
              )}
            </>
          )}
        </div>
      )) : (
        <p style={{ fontSize: 14, color: "#B7A69B", padding: "8px 0" }}>No entries in this view yet.</p>
      )}
    </div>
  );
}
