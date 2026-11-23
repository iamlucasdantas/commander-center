import { NextResponse } from "next/server";
import {
  effectivePriority, getState, makeTask, mutateState, stateConfigured,
  type PanelTask,
} from "@/lib/state";

// PENDÊNCIAS do Lucas (unificação, 2026-11-22): o que ele tem que
// fazer, em P1, P2 e P3 pela regra dele de 2026-11-18, gravado no
// armazenamento interno do painel (state.ts), o mesmo do log.
//   GET    /api/tasks  -> abertas primeiro (P1, P2, P3; dentro da
//          faixa, na ordem em que foram colocadas), concluídas no fim
//   POST   /api/tasks  -> nova pendência { title, priority?, project?,
//          note?, supportTicket?, definitiveSolution? }
//   PATCH  /api/tasks  -> { id, action: "toggle" } conclui ou reabre;
//          { id, action: "priority", priority } move de faixa;
//          { id, action: "update", ...campos } edita
//   DELETE /api/tasks  -> { id } remove
// A regra é forçada AQUI no servidor, igual à central fazia: ticket
// de suporte sem solução definitiva é gravado como P3, sempre.
// A migração inicial (lista da central lida ao vivo em 2026-11-22,
// vazia) é carimbada na primeira escrita/leitura via ensureSeeded.
// Nada aqui escreve fora do painel.
export const maxDuration = 60;

/** Data da leitura ao vivo da lista da central (0 itens) que semeia a visão. */
const MIGRATION_ISO = "2026-11-22T18:30:00.000Z";

function sortTasks(tasks: PanelTask[]): PanelTask[] {
  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");
  open.sort((a, b) => effectivePriority(a) - effectivePriority(b) || (a.createdAt < b.createdAt ? -1 : 1));
  done.sort((a, b) => ((a.completedAt ?? "") < (b.completedAt ?? "") ? 1 : -1));
  return [...open, ...done];
}

function asPriority(v: unknown): 1 | 2 | 3 {
  return v === 1 || v === 2 || v === 3 ? v : 2;
}

function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

async function ensureSeeded(): Promise<void> {
  const s = await getState(0);
  if (s.tasksSeededAt) return;
  await mutateState((st) => {
    if (!st.tasksSeededAt) st.tasksSeededAt = MIGRATION_ISO;
  });
}

export async function GET() {
  if (!stateConfigured()) {
    return NextResponse.json({ ok: true, tasks: [], configured: false });
  }
  await ensureSeeded();
  const s = await getState(0);
  return NextResponse.json({ ok: true, tasks: sortTasks(s.tasks), configured: true, seededAt: s.tasksSeededAt ?? null });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const title = cleanText(body?.title, 300);
  if (!title) {
    return NextResponse.json({ ok: false, error: "Title is required" }, { status: 400 });
  }
  if (!stateConfigured()) {
    return NextResponse.json({ ok: false, error: "Internal storage is not configured yet" }, { status: 503 });
  }
  const draft = {
    title,
    priority: asPriority(body?.priority),
    project: cleanText(body?.project, 120),
    note: cleanText(body?.note, 2000),
    supportTicket: body?.supportTicket === true,
    definitiveSolution: body?.definitiveSolution === true,
    origin: "panel" as const,
  };
  // A regra do Lucas, forçada na gravação: ticket sem solução definitiva é P3.
  draft.priority = effectivePriority(draft);
  const task = makeTask(draft);
  try {
    await mutateState((s) => {
      if (!s.tasksSeededAt) s.tasksSeededAt = MIGRATION_ISO;
      s.tasks.push(task);
    });
  } catch {
    return NextResponse.json({ ok: false, error: "The internal storage did not answer" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, task });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!id || !["toggle", "priority", "update"].includes(action)) {
    return NextResponse.json({ ok: false, error: "id and a valid action are required" }, { status: 400 });
  }
  if (!stateConfigured()) {
    return NextResponse.json({ ok: false, error: "Internal storage is not configured yet" }, { status: 503 });
  }
  let updated: PanelTask | null = null;
  try {
    await mutateState((s) => {
      const t = s.tasks.find((x) => x.id === id);
      if (!t) return;
      if (action === "toggle") {
        if (t.status === "open") {
          t.status = "done";
          t.completedAt = new Date().toISOString();
        } else {
          t.status = "open";
          t.completedAt = undefined;
        }
      } else if (action === "priority") {
        t.priority = effectivePriority({ ...t, priority: asPriority(body?.priority) });
      } else if (action === "update") {
        const title = cleanText(body?.title, 300);
        if (title) t.title = title;
        t.project = cleanText(body?.project, 120);
        t.note = cleanText(body?.note, 2000);
        if (typeof body?.supportTicket === "boolean") t.supportTicket = body.supportTicket;
        if (typeof body?.definitiveSolution === "boolean") t.definitiveSolution = body.definitiveSolution;
        if (body?.priority !== undefined) t.priority = asPriority(body?.priority);
        t.priority = effectivePriority(t);
      }
      updated = { ...t };
    });
  } catch {
    return NextResponse.json({ ok: false, error: "The internal storage did not answer" }, { status: 502 });
  }
  if (!updated) {
    return NextResponse.json({ ok: false, error: "Task not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, task: updated });
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }
  if (!stateConfigured()) {
    return NextResponse.json({ ok: false, error: "Internal storage is not configured yet" }, { status: 503 });
  }
  let removed = false;
  try {
    await mutateState((s) => {
      const before = s.tasks.length;
      s.tasks = s.tasks.filter((t) => t.id !== id);
      removed = s.tasks.length !== before;
    });
  } catch {
    return NextResponse.json({ ok: false, error: "The internal storage did not answer" }, { status: 502 });
  }
  if (!removed) {
    return NextResponse.json({ ok: false, error: "Task not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
