"use client";

import { useState } from "react";
import type { VerifyData } from "./VerifyLeads";

interface AccountRef {
  slug: string;
  name: string;
}

interface Row extends VerifyData {
  slug: string;
  name: string;
  failed?: boolean;
}

type Phase = "idle" | "running" | "done";

/**
 * Botão "Verify all leads" da home: roda a verificação completa em
 * todas as contas conectadas, uma de cada vez (para não martelar a API
 * do HighLevel), e mostra o resumo por conta ao final. Só leitura.
 */
export default function VerifyAllLeads({ accounts }: { accounts: AccountRef[] }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  async function run() {
    setPhase("running");
    setRows([]);
    const out: Row[] = [];
    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      setProgress(`Verifying ${acc.name} (${i + 1} of ${accounts.length})...`);
      try {
        const res = await fetch("/api/verify-leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: acc.slug }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          out.push({
            slug: acc.slug, name: acc.name,
            total: data.total, scanned: data.scanned, verified: data.verified,
            unverified: data.unverified, fakes: data.fakes, partner: data.partner,
            checkedAt: data.checkedAt,
          });
        } else {
          out.push({ slug: acc.slug, name: acc.name, total: 0, scanned: 0, verified: 0, unverified: 0, fakes: 0, partner: 0, checkedAt: "", failed: true });
        }
      } catch {
        out.push({ slug: acc.slug, name: acc.name, total: 0, scanned: 0, verified: 0, unverified: 0, fakes: 0, partner: 0, checkedAt: "", failed: true });
      }
      setRows([...out]);
    }
    setProgress("");
    setPhase("done");
  }

  const totals = rows.filter((r) => !r.failed).reduce(
    (s, r) => ({
      total: s.total + r.total, verified: s.verified + r.verified,
      unverified: s.unverified + r.unverified, fakes: s.fakes + r.fakes, partner: s.partner + r.partner,
    }),
    { total: 0, verified: 0, unverified: 0, fakes: 0, partner: 0 },
  );

  return (
    <div>
      <div className="actionrow" style={{ marginTop: 0 }}>
        {phase !== "running" ? (
          <button type="button" className="btn" onClick={run}>
            {phase === "done" ? "Verify all leads again" : "Verify all leads"}
          </button>
        ) : (
          <button type="button" className="btn" disabled>Verifying...</button>
        )}
        <span className="hint">Full scan of every connected account, one at a time. Read-only, nothing changes in HighLevel.</span>
      </div>
      {phase === "running" && <p className="hint" style={{ marginTop: 10 }}>{progress}</p>}
      {rows.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {rows.map((r) => (
            <div className="conv" key={r.slug}>
              <span>{r.name}</span>
              {r.failed ? (
                <span className="resultbad">failed</span>
              ) : (
                <span className="verifyline">
                  <b>{r.total.toLocaleString("en-US")}</b> · <b className="vok">{r.verified.toLocaleString("en-US")} verified</b> · {r.unverified.toLocaleString("en-US")} unverified · {r.fakes.toLocaleString("en-US")} fakes
                  {r.partner > 0 && <> · {r.partner.toLocaleString("en-US")} Partner $1</>}
                </span>
              )}
            </div>
          ))}
          {phase === "done" && (
            <p className="hint" style={{ marginTop: 10 }}>
              Portfolio: <b>{totals.total.toLocaleString("en-US")}</b> contacts · {totals.verified.toLocaleString("en-US")} verified · {totals.unverified.toLocaleString("en-US")} unverified · {totals.fakes.toLocaleString("en-US")} fakes
              {totals.partner > 0 && <> · {totals.partner.toLocaleString("en-US")} Partner $1</>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
