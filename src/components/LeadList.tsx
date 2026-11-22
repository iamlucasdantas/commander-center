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
  /** Quando presente (só a página da conta passa), cada lead não
   *  verificado ganha caixa de seleção e botão individual de verificar,
   *  e a seleção ganha a ação "Verify selected". */
  verifySlug?: string;
}

/**
 * Lista de leads com filtro Verified x Unverified.
 *
 * Verified = entrou por formulário, calendário, chat, workflow etc.
 * (selo "lead"), OU foi verificado à mão pelo Lucas (selo "verified",
 * tag "lead-verified" no HighLevel). Unverified = email avulso, sem
 * origem rastreável (selo "unverified"). Fakes não chegam aqui: ficam
 * na quarentena.
 *
 * O filtro é estado do cliente: alterna na hora, sem recarregar e sem
 * tocar no cache de 5 minutos da coleta.
 *
 * Ação em massa sobre o grupo filtrado: com `deleteSlug` (só a página
 * da conta passa), o resumo do grupo Unverified mostra o botão de
 * excluir os não verificados no HighLevel (decisão do Lucas, 2026-11-22:
 * exclusão de verdade, em dois passos, com registro para download).
 * A home não passa deleteSlug, então lá nada muda.
 *
 * Verificação seletiva: com `verifySlug` (só a página da conta passa),
 * verificar um lead aplica a tag "lead-verified" no contato no
 * HighLevel (rota /api/verify-contact) e a linha vira "verified" na
 * hora; a classificação do painel inteiro passa a tratá-lo como
 * verificado. Correção do Lucas, 2026-11-22 14:54: nada de verificar
 * todos de uma vez, é selecionar ou fazer individualmente. Se a tag
 * falhar (ex.: chave sem permissão de escrita), o erro aparece na tela.
 */
export default function LeadList({ leads, emptyText, deleteSlug, verifySlug }: Props) {
  const [filter, setFilter] = useState<LeadFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [localVerified, setLocalVerified] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Verificado nesta sessão conta na hora, sem esperar o cache virar.
  const isUnv = (l: LeadItem) => l.emailOnly && !localVerified.has(l.id);
  const isTagged = (l: LeadItem) => l.manuallyVerified || localVerified.has(l.id);

  const verified = useMemo(() => leads.filter((l) => !isUnv(l)), [leads, localVerified]);
  const unverified = useMemo(() => leads.filter((l) => isUnv(l)), [leads, localVerified]);
  const visible = filter === "verified" ? verified : filter === "unverified" ? unverified : leads;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function verifyIds(idsToVerify: string[]) {
    if (!verifySlug || idsToVerify.length === 0 || busy) return;
    setBusy(true);
    setVerifyMsg(null);
    try {
      const res = await fetch("/api/verify-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: verifySlug, ids: idsToVerify }),
      });
      const data = await res.json().catch(() => ({}));
      const okIds: string[] = Array.isArray(data.results)
        ? data.results.filter((r: { ok?: boolean }) => r.ok).map((r: { id: string }) => r.id)
        : [];
      if (okIds.length > 0) {
        setLocalVerified((prev) => new Set([...prev, ...okIds]));
        setSelected((prev) => new Set([...prev].filter((id) => !okIds.includes(id))));
      }
      const failed = typeof data.failedCount === "number" ? data.failedCount : idsToVerify.length - okIds.length;
      if (okIds.length > 0 && failed === 0) {
        setVerifyMsg({ kind: "ok", text: `${okIds.length} lead${okIds.length === 1 ? "" : "s"} verified (tag lead-verified applied in HighLevel).` });
      } else if (okIds.length > 0) {
        setVerifyMsg({ kind: "error", text: `${okIds.length} verified, ${failed} could not be verified${data.error ? `: ${data.error}` : ""}.` });
      } else {
        setVerifyMsg({ kind: "error", text: data.error ?? "The verification did not go through. Nothing was marked." });
      }
    } catch {
      setVerifyMsg({ kind: "error", text: "Network error. Nothing was marked." });
    }
    setBusy(false);
  }

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

      {verifySlug && selected.size > 0 && (
        <div className="selbar">
          <b>{selected.size} selected</b>
          <button type="button" className="btn primary selbtn" disabled={busy} onClick={() => verifyIds([...selected])}>
            {busy ? "Verifying..." : `Verify selected (${selected.size})`}
          </button>
          <button type="button" className="btn mini" disabled={busy} onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {verifyMsg && (
        <p className={verifyMsg.kind === "ok" ? "resultok" : "resultbad"} style={{ fontSize: 13.5, margin: "8px 0" }}>{verifyMsg.text}</p>
      )}

      {visible.length ? (
        visible.map((l) => {
          const unv = isUnv(l);
          const tagged = isTagged(l);
          return (
            <div className="lead" key={l.id}>
              <span style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                {verifySlug && unv && (
                  <input
                    type="checkbox"
                    className="leadcheck"
                    checked={selected.has(l.id)}
                    disabled={busy}
                    onChange={() => toggle(l.id)}
                    aria-label={`Select ${l.name} to verify`}
                  />
                )}
                <span>{l.name}<br /><small>{l.when}, {l.sourceLabel}</small></span>
              </span>
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                {verifySlug && unv && (
                  <button type="button" className="btn mini" disabled={busy} onClick={() => verifyIds([l.id])}>Verify</button>
                )}
                {tagged ? (
                  <span className="tag">verified</span>
                ) : unv ? (
                  <span className="tag email">unverified</span>
                ) : (
                  <span className="tag">lead</span>
                )}
              </span>
            </div>
          );
        })
      ) : (
        <p style={{ fontSize: 14, color: "#B7A69B", padding: "8px 0" }}>
          {filter === "unverified" ? "No unverified leads in this list." : "No verified leads in this list."}
        </p>
      )}
    </div>
  );
}
