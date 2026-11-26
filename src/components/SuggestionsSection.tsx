"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { AgentSuggestion, SuggestionStatus } from "@/lib/state";

// SUGESTÕES DOS AGENTES (pedido do Lucas, 2026-11-26): PRIMEIRO
// bloco da página do cliente no /v2. Os agentes gravam pela rota
// /api/openbot/suggestions; aqui o Lucas lê o que fazer, por quê e
// o plano completo, copia o prompt de execução pronto para colar no
// agente responsável e controla o status (Aprovar, Descartar,
// Marcar feita), persistido em /api/suggestions no armazenamento
// interno do painel. Feitas e descartadas ficam atrás do botão de
// mostrar, como as concluídas das pendências.

const STATUS_LABEL: Record<SuggestionStatus, string> = {
  nova: "Nova",
  aprovada: "Aprovada",
  descartada: "Descartada",
  feita: "Feita",
};

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago",
  });
}

/** Negrito, código inline e links, sem HTML cru: tudo vira nó do React. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) parts.push(<b key={key}>{tok.slice(2, -2)}</b>);
    else if (tok.startsWith("`")) parts.push(<code key={key} className="mdcode">{tok.slice(1, -1)}</code>);
    else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      if (link) {
        parts.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer" style={{ color: "#F0772E", fontWeight: 600 }}>
            {link[1]}
          </a>,
        );
      } else parts.push(tok);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * Markdown enxuto para os planos dos agentes: títulos (# a ####),
 * listas com - ou *, listas numeradas, citações, código cercado e
 * parágrafos. Suficiente para ler o plano com conforto, sem trazer
 * uma biblioteca nova para o projeto.
 */
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;
  let k = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{renderInline(it, `li${k}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={`b${k++}`}>{items}</ol> : <ul key={`b${k++}`}>{items}</ul>);
    list = null;
  };
  const flushCode = () => {
    if (!code) return;
    blocks.push(<pre key={`b${k++}`} className="mdpre">{code.join("\n")}</pre>);
    code = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim().startsWith("```")) {
      if (code) flushCode();
      else { flushList(); code = []; }
      continue;
    }
    if (code) { code.push(raw); continue; }
    const t = line.trim();
    if (!t) { flushList(); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) {
      flushList();
      const inner = renderInline(h[2], `h${k}`);
      if (h[1].length <= 2) blocks.push(<h4 key={`b${k++}`} className="mdh">{inner}</h4>);
      else blocks.push(<h5 key={`b${k++}`} className="mdh5">{inner}</h5>);
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(t);
    const ol = /^\d+[.)]\s+(.*)$/.exec(t);
    if (ul || ol) {
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    if (t.startsWith("> ")) {
      flushList();
      blocks.push(<blockquote key={`b${k++}`} className="mdquote">{renderInline(t.slice(2), `q${k}`)}</blockquote>);
      continue;
    }
    flushList();
    blocks.push(<p key={`b${k++}`}>{renderInline(t, `p${k}`)}</p>);
  }
  flushList();
  flushCode();
  return <div className="md">{blocks}</div>;
}

export default function SuggestionsSection({ initial }: { initial: AgentSuggestion[] }) {
  const [items, setItems] = useState<AgentSuggestion[]>(initial);
  const [openPlan, setOpenPlan] = useState<Record<string, boolean>>({});
  const [showClosed, setShowClosed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [items],
  );
  const active = sorted.filter((s) => s.status === "nova" || s.status === "aprovada");
  const closed = sorted.filter((s) => s.status === "feita" || s.status === "descartada");
  const newCount = sorted.filter((s) => s.status === "nova").length;

  async function copyPrompt(s: AgentSuggestion) {
    try {
      await navigator.clipboard.writeText(s.prompt);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = s.prompt;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* o texto continua visível no cartão */ }
      document.body.removeChild(ta);
    }
    setCopiedId(s.id);
    setTimeout(() => setCopiedId((cur) => (cur === s.id ? null : cur)), 2200);
  }

  async function setStatus(s: AgentSuggestion, status: SuggestionStatus) {
    if (busyId) return;
    setBusyId(s.id);
    setMsg(null);
    try {
      const res = await fetch("/api/suggestions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.suggestion) {
        setItems((prev) => prev.map((x) => (x.id === s.id ? (data.suggestion as AgentSuggestion) : x)));
      } else {
        setMsg(data.error ?? "The change could not be saved.");
      }
    } catch {
      setMsg("The change could not be saved.");
    }
    setBusyId(null);
  }

  function card(s: AgentSuggestion) {
    const expanded = Boolean(openPlan[s.id]);
    return (
      <div className={`sugg-card st-${s.status}`} key={s.id}>
        <div className="sugg-head">
          <span className="sugg-agent">{s.agent}</span>
          <span className={`sugg-status st-${s.status}`}>{STATUS_LABEL[s.status]}</span>
          <span className="sugg-when">{fmtWhen(s.createdAt)} · Chicago</span>
        </div>
        <div className="sugg-title">{s.title}</div>
        <p className="sugg-why">{s.why}</p>
        {expanded && (
          <div className="sugg-plan">
            <Markdown text={s.planMd} />
          </div>
        )}
        <div className="sugg-actions">
          <button type="button" className="tagbtn" onClick={() => setOpenPlan((p) => ({ ...p, [s.id]: !expanded }))}>
            {expanded ? "Hide the full plan" : "See the full plan"}
          </button>
          <button type="button" className="btn mini sugg-copy" onClick={() => copyPrompt(s)}>
            {copiedId === s.id ? "Prompt copied ✓" : "Copiar prompt"}
          </button>
          <span className="sugg-spacer" />
          {s.status !== "aprovada" && s.status !== "feita" && (
            <button type="button" className="tagbtn" disabled={busyId === s.id} onClick={() => setStatus(s, "aprovada")}>Aprovar</button>
          )}
          {s.status !== "feita" && (
            <button type="button" className="tagbtn" disabled={busyId === s.id} onClick={() => setStatus(s, "feita")}>Marcar feita</button>
          )}
          {s.status !== "descartada" && (
            <button type="button" className="tagbtn" disabled={busyId === s.id} onClick={() => setStatus(s, "descartada")}>Descartar</button>
          )}
          {s.status !== "nova" && (
            <button type="button" className="tagbtn" disabled={busyId === s.id} onClick={() => setStatus(s, "nova")}>Reabrir</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Agent suggestions">
      <h2>
        Sugestões dos agentes
        {newCount > 0 && <span className="sugg-newcount">{newCount} nova{newCount === 1 ? "" : "s"}</span>}
      </h2>
      {msg && <p className="resultbad" style={{ fontSize: 13.5, margin: "0 0 10px" }}>{msg}</p>}
      {sorted.length === 0 ? (
        <div className="card">
          <p style={{ fontSize: 14, color: "#B7A69B" }}>
            Nenhuma sugestão de agente para este cliente ainda. Quando um agente (SEO, Social Media,
            Crescimento, Account Manager) sugerir algo para este cliente, a sugestão aparece aqui
            primeiro, com o plano completo e o prompt pronto para despachar.
          </p>
        </div>
      ) : (
        <div className="sugg-list">
          {active.map(card)}
          {closed.length > 0 && (
            <div>
              <button type="button" className="tagbtn" onClick={() => setShowClosed((v) => !v)}>
                {showClosed ? "Hide" : "Show"} feitas e descartadas ({closed.length})
              </button>
              {showClosed && <div className="sugg-list" style={{ marginTop: 12 }}>{closed.map(card)}</div>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
