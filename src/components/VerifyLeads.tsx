"use client";

import { useState } from "react";

export interface VerifyData {
  total: number;
  scanned: number;
  verified: number;
  unverified: number;
  fakes: number;
  partner: number;
  checkedAt: string;
}

type Phase = "idle" | "running" | "done" | "error";

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago",
  });
}

export function VerifySummary({ r, showPartner }: { r: VerifyData; showPartner: boolean }) {
  return (
    <span className="verifyline">
      <b>{r.total.toLocaleString("en-US")}</b> contacts ·{" "}
      <b className="vok">{r.verified.toLocaleString("en-US")} verified</b> ·{" "}
      <b>{r.unverified.toLocaleString("en-US")} unverified</b> ·{" "}
      <b>{r.fakes.toLocaleString("en-US")} fakes</b>
      {showPartner && <> · <b>{r.partner.toLocaleString("en-US")} Partner $1</b></>}
      {r.scanned < r.total && <> · scanned {r.scanned.toLocaleString("en-US")}</>}
      {" "}· checked {fmtWhen(r.checkedAt)}
    </span>
  );
}

/**
 * Botão "Verify leads" da página da conta: roda a verificação completa
 * (todos os contatos da location, sem o teto de 500) e mostra a
 * contagem por classe na tela. Só leitura: nada muda no HighLevel.
 */
export default function VerifyLeads({ slug, showPartner }: { slug: string; showPartner: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<VerifyData | null>(null);
  const [error, setError] = useState("");

  async function run() {
    setPhase("running");
    setError("");
    try {
      const res = await fetch("/api/verify-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setResult({
          total: data.total, scanned: data.scanned, verified: data.verified,
          unverified: data.unverified, fakes: data.fakes, partner: data.partner,
          checkedAt: data.checkedAt,
        });
        setPhase("done");
      } else {
        setError(data.error ?? "The verification did not finish");
        setPhase("error");
      }
    } catch {
      setError("Network error");
      setPhase("error");
    }
  }

  return (
    <>
      <span className="verifyline">Lead check: full scan of every contact in this location, classified verified, unverified or fake.</span>
      {phase === "idle" && (
        <button type="button" className="btn mini" onClick={run}>Verify leads</button>
      )}
      {phase === "running" && (
        <button type="button" className="btn mini" disabled>Verifying all contacts...</button>
      )}
      {phase === "done" && result && (
        <>
          <VerifySummary r={result} showPartner={showPartner} />
          <button type="button" className="btn mini" onClick={run}>Verify again</button>
        </>
      )}
      {phase === "error" && (
        <span>
          <span className="resultbad">{error}</span>{" "}
          <button type="button" className="btn mini" onClick={run}>Try again</button>
        </span>
      )}
    </>
  );
}
