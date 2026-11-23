"use client";

import { useMemo, useState } from "react";
import type { PanelTask } from "@/lib/state";

// PENDÊNCIAS do Lucas (unificação, 2026-11-22): as três faixas
// P1/P2/P3 da regra dele de 2026-11-18, trabalhando ao vivo sobre
// /api/tasks (armazenamento interno do painel). Marcar conclui na
// hora; mover de faixa e apagar também. A regra do ticket de
// suporte (sem solução definitiva é sempre P3) é forçada no
// servidor; o effP local só espelha a mesma regra na exibição.
function effP(t: Pick<PanelTask, "priority" | "supportTicket" | "definitiveSolution">): 1 | 2 | 3 {
  return t.supportTicket && !t.definitiveSolution ? 3 : t.priority;
}

const BAND_DEF: Record<1 | 2 | 3, string> = {
  1: "Brings clients, money, recurring revenue, saves time or creates leverage",
  2: "Important, but it does not bring money directly",
  3: "Lowest first · support tickets live here, unless the fix is definitive",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}

export default function TasksPanel({ initialTasks }: { initialTasks: PanelTask[] }) {
  const [tasks, setTasks] = useState<PanelTask[]>(initialTasks);
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [priority, setPriority] = useState<1 | 2 | 3>(1);
  const [note, setNote] = useState("");
  const [supportTicket, setSupportTicket] = useState(false);
  const [definitiveSolution, setDefinitiveSolution] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const open = useMemo(
    () => tasks.filter((t) => t.status === "open").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    [tasks],
  );
  const done = useMemo(
    () => tasks.filter((t) => t.status === "done").sort((a, b) => ((a.completedAt ?? "") < (b.completedAt ?? "") ? 1 : -1)),
    [tasks],
  );

  async function call(method: string, body: Record<string, unknown>): Promise<PanelTask | null> {
    const res = await fetch("/api/tasks", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setMsg({ kind: "error", text: data.error ?? "The change could not be saved." });
      return null;
    }
    return (data.task as PanelTask) ?? null;
  }

  async function addTask() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    const created = await call("POST", {
      title: title.trim(),
      project: project.trim() || undefined,
      note: note.trim() || undefined,
      priority,
      supportTicket,
      definitiveSolution,
    });
    if (created) {
      setTasks((prev) => [...prev, created]);
      setTitle("");
      setProject("");
      setNote("");
      setSupportTicket(false);
      setDefinitiveSolution(false);
      if (supportTicket && !definitiveSolution && created.priority === 3 && priority !== 3) {
        setMsg({ kind: "ok", text: "Saved in P3: a support ticket without a definitive solution is always P3 (your rule)." });
      } else {
        setMsg({ kind: "ok", text: "Priority saved." });
      }
    }
    setBusy(false);
  }

  async function toggle(t: PanelTask) {
    const updated = await call("PATCH", { id: t.id, action: "toggle" });
    if (updated) setTasks((prev) => prev.map((x) => (x.id === t.id ? updated : x)));
  }

  async function move(t: PanelTask, p: 1 | 2 | 3) {
    const updated = await call("PATCH", { id: t.id, action: "priority", priority: p });
    if (updated) {
      setTasks((prev) => prev.map((x) => (x.id === t.id ? updated : x)));
      if (updated.priority !== p) {
        setMsg({ kind: "ok", text: "Kept in P3: a support ticket without a definitive solution cannot leave P3 (your rule)." });
      }
    }
  }

  async function remove(t: PanelTask) {
    const res = await fetch("/api/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) setTasks((prev) => prev.filter((x) => x.id !== t.id));
    else setMsg({ kind: "error", text: data.error ?? "The item could not be removed." });
  }

  function row(t: PanelTask) {
    const p = effP(t);
    return (
      <div className={`taskrow${t.status === "done" ? " done" : ""}`} key={t.id}>
        <input
          type="checkbox"
          className="taskcheck"
          checked={t.status === "done"}
          onChange={() => toggle(t)}
          aria-label={t.status === "done" ? "Reopen" : "Mark as done"}
        />
        <div className="taskmain">
          <div className="tasktitle">{t.title}</div>
          <span className="taskmeta">
            {t.project && <span className="srcchip ritual">{t.project}</span>}
            <span>since {fmtDate(t.createdAt)}</span>
            {t.supportTicket && <span className="srcchip highlevel">support ticket</span>}
            {t.definitiveSolution && <span className="srcchip google">definitive solution</span>}
            {t.status === "done" && t.completedAt && <span>done {fmtDate(t.completedAt)}</span>}
          </span>
          {t.note && <span className="tasknote">{t.note}</span>}
        </div>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flex: "none" }}>
          {t.status === "open" && ([1, 2, 3] as const).map((n) => (
            <button
              key={n}
              type="button"
              className="tagbtn"
              disabled={p === n}
              onClick={() => move(t, n)}
              aria-label={`Move to P${n}`}
              style={p === n ? { borderColor: "#EB611C", color: "#F0772E" } : undefined}
            >
              P{n}
            </button>
          ))}
          <button type="button" className="tagbtn" onClick={() => remove(t)} aria-label="Remove">Remove</button>
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="logform">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New priority: what do you have to do?"
          aria-label="Priority title"
          onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
        />
        <input
          type="text"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          placeholder="Project or client (optional)"
          aria-label="Project or client"
          style={{ flex: "0 1 190px" }}
        />
        <select value={priority} onChange={(e) => setPriority(Number(e.target.value) as 1 | 2 | 3)} aria-label="Priority">
          <option value={1}>P1</option>
          <option value={2}>P2</option>
          <option value={3}>P3</option>
        </select>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          aria-label="Note"
          style={{ flex: "1 1 160px" }}
        />
        <label className="checkline2">
          <input type="checkbox" checked={supportTicket} onChange={(e) => setSupportTicket(e.target.checked)} />
          Support ticket
        </label>
        <label className="checkline2">
          <input type="checkbox" checked={definitiveSolution} onChange={(e) => setDefinitiveSolution(e.target.checked)} />
          Definitive solution
        </label>
        <button type="button" className="btn" disabled={busy || !title.trim()} onClick={addTask}>
          {busy ? "Saving..." : "Add priority"}
        </button>
      </div>
      {msg && (
        <p className={msg.kind === "ok" ? "resultok" : "resultbad"} style={{ fontSize: 13.5, margin: "8px 0" }}>{msg.text}</p>
      )}

      {([1, 2, 3] as const).map((p) => {
        const band = open.filter((t) => effP(t) === p);
        return (
          <div className={`taskband p${p}`} key={p}>
            <div className="taskband-head">
              <h3>Priority {p}</h3>
              <span className="def">{BAND_DEF[p]}</span>
              <span className="taskcount">{band.length}</span>
            </div>
            {band.length ? band.map(row) : (
              <p style={{ fontSize: 13.5, color: "#8A7A70", padding: "4px 0" }}>Nothing open in this band.</p>
            )}
          </div>
        );
      })}

      <div style={{ marginTop: 6 }}>
        <button type="button" className="tagbtn" onClick={() => setShowDone((v) => !v)}>
          {showDone ? "Hide" : "Show"} completed ({done.length})
        </button>
        {showDone && (
          <div className="card" style={{ marginTop: 10 }}>
            {done.length ? done.map(row) : (
              <p style={{ fontSize: 13.5, color: "#8A7A70" }}>Nothing completed yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
