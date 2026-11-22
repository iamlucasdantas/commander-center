"use client";

import { useState } from "react";
import type { ContactRecord } from "@/lib/hl";

interface Prepared {
  total: number;
  separatedCount: number;
  pendingCount: number;
  pending: ContactRecord[];
}

interface ResultRow {
  id: string;
  name: string;
  dnd: boolean;
  tag: boolean;
}

type Phase = "idle" | "preparing" | "prepared" | "executing" | "done" | "error";

/**
 * Separação dos compradores Partner US$ 1 dentro do HighLevel, na página
 * da conta Magnetic Funnels (US): liga o DND de cada contato do grupo e
 * adiciona a tag "partner-usd1", para eles ficarem numa lista separada e
 * fora das campanhas. Dois passos: prepare mostra a contagem exata dos
 * que faltam separar; execute aplica contato a contato e reporta cada um.
 */
export default function PartnerSeparate({ slug, hidden, separated }: { slug: string; hidden: number; separated: number }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [error, setError] = useState("");

  async function prepare() {
    setPhase("preparing");
    setError("");
    try {
      const res = await fetch("/api/partner-separate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, mode: "prepare" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setPrepared({
          total: data.total,
          separatedCount: data.separatedCount,
          pendingCount: data.pendingCount,
          pending: data.pending ?? [],
        });
        setPhase("prepared");
      } else {
        setError(data.error ?? "Could not load the Partner group");
        setPhase("error");
      }
    } catch {
      setError("Network error");
      setPhase("error");
    }
  }

  async function execute() {
    if (!prepared) return;
    setPhase("executing");
    setError("");
    try {
      const ids = prepared.pending.map((c) => c.id);
      const res = await fetch("/api/partner-separate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, mode: "execute", ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setResults(data.results ?? []);
        setPhase("done");
      } else if (data.error === "no_write_permission") {
        setError("This account's key has no write permission yet");
        setPhase("error");
      } else {
        setError(data.error ?? "The separation did not finish");
        setPhase("error");
      }
    } catch {
      setError("Network error");
      setPhase("error");
    }
  }

  function reset() {
    setPhase("idle");
    setPrepared(null);
    setResults(null);
    setError("");
  }

  const doneCount = results?.filter((r) => r.dnd && r.tag).length ?? 0;

  return (
    <>
      <div className="partnerline">
        Partner $1 buyers hidden: <b>{hidden}</b>
        {separated > 0 && <span> · {separated} already separated in HighLevel</span>}
      </div>

      {phase === "idle" && (
        <button type="button" className="btn mini" onClick={prepare}>
          Separate in HighLevel (DND + tag)
        </button>
      )}

      {phase === "preparing" && (
        <button type="button" className="btn mini" disabled>
          Checking the group...
        </button>
      )}

      {phase === "prepared" && prepared && (
        <div className="confirmbox" style={{ flexBasis: "100%" }}>
          <b>{prepared.pendingCount} Partner contacts</b> to separate ({prepared.total} in the group, {prepared.separatedCount} already separated).
          Each one gets <b>DND on</b> and the tag <b>partner-usd1</b> in HighLevel.
          <div className="actionrow">
            <button type="button" className="btn" onClick={execute} disabled={prepared.pendingCount === 0}>
              Separate {prepared.pendingCount} contacts
            </button>
            <button type="button" className="btn mini" onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === "executing" && (
        <button type="button" className="btn mini" disabled>
          Separating in HighLevel...
        </button>
      )}

      {phase === "done" && results && (
        <div style={{ flexBasis: "100%" }}>
          <span className="resultok">Separated {doneCount} of {results.length} contacts.</span>
          {results.some((r) => !(r.dnd && r.tag)) && (
            <div style={{ marginTop: 6, fontSize: 13 }}>
              {results.filter((r) => !(r.dnd && r.tag)).map((r) => (
                <div key={r.id} className="resultbad">{r.name}: DND {r.dnd ? "on" : "failed"} · tag {r.tag ? "added" : "failed"}</div>
              ))}
            </div>
          )}
          <div className="actionrow">
            <button type="button" className="btn mini" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div>
          <span className="resultbad">{error}</span>{" "}
          <button type="button" className="btn mini" onClick={reset}>
            Back
          </button>
        </div>
      )}
    </>
  );
}
