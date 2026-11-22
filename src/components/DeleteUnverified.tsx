"use client";

import { useState } from "react";
import type { ContactRecord } from "@/lib/hl";

interface Prepared {
  count: number;
  record: { account: string; generatedAt: string; contacts: ContactRecord[] };
}

interface ExecuteResult {
  deletedCount: number;
  failedCount: number;
  failed: Array<{ id: string; name: string; status: number }>;
}

type Phase = "idle" | "preparing" | "prepared" | "executing" | "done" | "error";

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Ação "Delete unverified in HighLevel" da página da conta (decisão do
 * Lucas, 2026-11-22). Fluxo em dois passos, nada de um clique só:
 *   1. Prepare: o servidor classifica os contatos frescos e devolve a
 *      contagem exata e o registro completo do que será excluído.
 *   2. O registro precisa ser baixado e a confirmação marcada; só então
 *      o botão final libera e o servidor apaga contato a contato,
 *      devolvendo o registro final (baixado automaticamente).
 * Escopo: os não verificados dos últimos 7 dias, o mesmo conjunto do
 * filtro Unverified desta lista. Fakes e verificados nunca entram.
 */
export default function DeleteUnverified({ slug }: { slug: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [recordSaved, setRecordSaved] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [error, setError] = useState("");

  async function prepare() {
    setPhase("preparing");
    setError("");
    try {
      const res = await fetch("/api/delete-unverified", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, mode: "prepare" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setPrepared({ count: data.count, record: data.record });
        setRecordSaved(false);
        setConfirmed(false);
        setPhase("prepared");
      } else {
        setError(data.error ?? "Could not prepare the deletion");
        setPhase("error");
      }
    } catch {
      setError("Network error");
      setPhase("error");
    }
  }

  function saveRecord() {
    if (!prepared) return;
    downloadJson(`delete-unverified-${slug}-${prepared.record.generatedAt.slice(0, 10)}.json`, prepared.record);
    setRecordSaved(true);
  }

  async function execute() {
    if (!prepared) return;
    setPhase("executing");
    setError("");
    try {
      const ids = prepared.record.contacts.map((c) => c.id);
      const res = await fetch("/api/delete-unverified", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, mode: "execute", ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.record) {
        downloadJson(`deleted-unverified-${slug}-${new Date().toISOString().slice(0, 10)}.json`, data.record);
      }
      if (res.ok && data.ok) {
        setResult({ deletedCount: data.deletedCount, failedCount: data.failedCount, failed: data.failed ?? [] });
        setPhase("done");
      } else if (data.error === "no_delete_permission") {
        setError("This account's key has no delete permission yet");
        setPhase("error");
      } else {
        setError(data.error ?? "The deletion did not finish");
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
    setResult(null);
    setError("");
    setRecordSaved(false);
    setConfirmed(false);
  }

  return (
    <div className="dangerzone">
      {phase === "idle" && (
        <>
          <button type="button" className="dbtn" onClick={prepare}>
            Delete unverified in HighLevel
          </button>
          <p className="hint" style={{ marginTop: 8 }}>
            Permanently deletes this week's unverified contacts in HighLevel. Two-step confirmation, with a downloadable record first. Fakes and verified leads are never touched.
          </p>
        </>
      )}

      {phase === "preparing" && (
        <button type="button" className="dbtn" disabled>
          Preparing deletion record...
        </button>
      )}

      {phase === "prepared" && prepared && (
        <div className="confirmbox">
          <b>{prepared.count} unverified contacts</b> from the last 7 days will be permanently deleted in HighLevel.
          {prepared.record.contacts.length > 0 && (
            <div style={{ marginTop: 6, color: "#CBBBAE" }}>
              {prepared.record.contacts.slice(0, 5).map((c) => c.name).join(" · ")}
              {prepared.record.contacts.length > 5 ? ` · +${prepared.record.contacts.length - 5} more` : ""}
            </div>
          )}
          <div className="actionrow">
            <button type="button" className="btn mini" onClick={saveRecord}>
              {recordSaved ? "Record downloaded" : "Download deletion record"}
            </button>
          </div>
          <label className="checkline">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I understand this permanently deletes these {prepared.count} contacts in HighLevel and cannot be undone.</span>
          </label>
          <div className="actionrow">
            <button type="button" className="dbtn armed" onClick={execute} disabled={!recordSaved || !confirmed}>
              Delete {prepared.count} contacts
            </button>
            <button type="button" className="btn mini" onClick={reset}>
              Cancel
            </button>
          </div>
          {(!recordSaved || !confirmed) && (
            <p className="hint" style={{ marginTop: 6 }}>Download the record and check the confirmation to unlock the delete button.</p>
          )}
        </div>
      )}

      {phase === "executing" && (
        <button type="button" className="dbtn" disabled>
          Deleting in HighLevel...
        </button>
      )}

      {phase === "done" && result && (
        <div>
          <span className="resultok">Deleted {result.deletedCount} contacts in HighLevel.</span>
          {result.failedCount > 0 && (
            <span className="resultbad"> {result.failedCount} failed ({result.failed.map((f) => f.name).join(", ")}).</span>
          )}
          <div className="hint" style={{ marginTop: 4 }}>The deletion record was downloaded. Reload the page to see the updated list.</div>
          <div className="actionrow">
            <button type="button" className="btn mini" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        </div>
      )}

      {phase === "error" && (
        <div>
          <span className="resultbad">{error}</span>
          <div className="actionrow">
            <button type="button" className="btn mini" onClick={reset}>
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
