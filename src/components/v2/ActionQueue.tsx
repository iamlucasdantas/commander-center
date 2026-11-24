"use client";

import { useState } from "react";
import type { QueueItem } from "@/lib/v2insights";
import { money } from "@/lib/insights";

/**
 * Action queue do Cockpit (spec 2026-11-24): itens ordenados por
 * dinheiro em risco (ordenação feita no servidor), cada um com a
 * ação principal (deep link para o HighLevel), Snooze 1 dia e Done.
 * O estado vai para o armazenamento próprio do /v2
 * (POST /api/v2/queue -> v2-state.json); nada é escrito no HighLevel.
 */
export default function ActionQueue({ initialItems }: { initialItems: QueueItem[] }) {
  const [items, setItems] = useState<QueueItem[]>(initialItems);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function act(item: QueueItem, action: "snooze" | "done") {
    if (busy) return;
    setBusy(item.key);
    setFailed(null);
    try {
      const res = await fetch("/api/v2/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: item.key, action, signature: item.signature }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.key !== item.key));
      } else {
        setFailed(item.key);
      }
    } catch {
      setFailed(item.key);
    }
    setBusy(null);
  }

  if (items.length === 0) {
    return (
      <div className="alert"><b>All clear:</b> nothing waiting past threshold, no idle money, no volume drop, no suspicious spike.</div>
    );
  }

  return (
    <div className="queue">
      {items.map((item) => (
        <div className={`v2-qitem sev${item.severity}`} key={item.key}>
          <div className="qmetric">{item.metric}</div>
          <div className="qmain">
            <div className="qhead">
              <b>{item.account}</b>
              <span className="qheadline">{item.headline}</span>
            </div>
            <div className="qmeta">
              <span>{item.moneyAtRisk > 0 ? `${money(item.moneyAtRisk)} at risk` : "data quality alert"}</span>
              <span className="qaction">{item.action}</span>
              {failed === item.key && <span className="resultbad">Could not save. Try again.</span>}
            </div>
            <div className="v2-qactions">
              <a className="btnlink" href={item.deepLink} target={item.deepLink.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                {item.deepLabel}
              </a>
              <button type="button" className="btn mini" disabled={busy === item.key} onClick={() => act(item, "snooze")}>
                Snooze 1 day
              </button>
              <button type="button" className="btn mini" disabled={busy === item.key} onClick={() => act(item, "done")}>
                Done
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
