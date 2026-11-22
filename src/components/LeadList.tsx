"use client";

import { useMemo, useState } from "react";
import type { LeadItem } from "@/lib/hl";
import DeleteUnverified from "@/components/DeleteUnverified";

type LeadFilter = "all" | "verified" | "unverified";

interface Props {
  leads: LeadItem[];
  emptyText?: string;
  /** Quando presente (só a página da conta passa), o resumo do grupo
   *  Unverified ganha a ação "Delete unverified in HighLevel". */
  deleteSlug?: string;
}

/**
 * Lista de leads com filtro Verified x Unverified.
 *
 * Verified = entrou por formulário, calendário, chat, workflow etc.
 * (selo "lead"). Unverified = email avulso, sem origem rastreável
 * (selo "unverified"). Fakes não chegam aqui: ficam na quarentena.
 *
 * O filtro é estado do cliente: alterna na hora, sem recarregar e sem
 * tocar no cache de 5 minutos da coleta.
 *
 * Ação em massa sobre o grupo filtrado: com `deleteSlug` (só a página
 * da conta passa), o resumo do grupo Unverified mostra o botão de
 * excluir os não verificados no HighLevel (decisão do Lucas, 2026-11-22:
 * exclusão de verdade, em dois passos, com registro para download).
 * A home não passa deleteSlug, então lá nada muda.
 */
export default function LeadList({ leads, emptyText, deleteSlug }: Props) {
  const [filter, setFilter] = useState<LeadFilter>("all");

  const verified = useMemo(() => leads.filter((l) => !l.emailOnly), [leads]);
  const unverified = useMemo(() => leads.filter((l) => l.emailOnly), [leads]);
  const visible = filter === "verified" ? verified : filter === "unverified" ? unverified : leads;

  // De onde vêm os não verificados (ex.: "stray email · 40"), para o
  // resumo do grupo quando o filtro está em Unverified.
  const unverifiedSources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of unverified) counts.set(l.sourceLabel, (counts.get(l.sourceLabel) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [unverified]);

  if (leads.length === 0) {
    return <p style={{ fontSize: 14, color: "#B7A69B" }}>{emptyText ?? "No leads in the last 7 days."}</p>;
  }

  const options: Array<{ key: LeadFilter; label: string; count: number }> = [
    { key: "all", label: "All", count: leads.length },
    { key: "verified", label: "Verified", count: verified.length },
    { key: "unverified", label: "Unverified", count: unverified.length },
  ];

  return (
    <div>
      <div className="leadfilter" role="tablist" aria-label="Filter leads: all, verified or unverified">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={filter === o.key}
            className={`lfbtn${filter === o.key ? " on" : ""}`}
            onClick={() => setFilter(o.key)}
          >
            {o.label} <span className="lfcount">{o.count}</span>
          </button>
        ))}
      </div>

      {filter === "unverified" && (
        <div className="unvsummary">
          <b>{unverified.length} unverified</b> — stray email only, no form, calendar, chat or workflow behind them.
          {unverifiedSources.length > 0 && (
            <div className="unvsrc">
              {unverifiedSources.map(([src, n]) => (
                <span className="srcchip" key={src}>{src} · {n}</span>
              ))}
            </div>
          )}
          {deleteSlug && unverified.length > 0 && <DeleteUnverified slug={deleteSlug} />}
        </div>
      )}

      {visible.length ? (
        visible.map((l, i) => (
          <div className="lead" key={i}>
            <span>{l.name}<br /><small>{l.when}, {l.sourceLabel}</small></span>
            <span className={`tag${l.emailOnly ? " email" : ""}`}>{l.emailOnly ? "unverified" : "lead"}</span>
          </div>
        ))
      ) : (
        <p style={{ fontSize: 14, color: "#B7A69B", padding: "8px 0" }}>
          {filter === "unverified" ? "No unverified leads in this list." : "No verified leads in this list."}
        </p>
      )}
    </div>
  );
}
