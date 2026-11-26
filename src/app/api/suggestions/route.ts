import { NextResponse } from "next/server";
import {
  getState, mutateState, stateConfigured, SUGGESTION_STATUSES,
  type AgentSuggestion, type SuggestionStatus,
} from "@/lib/state";

// SUGESTÕES DOS AGENTES na página do cliente (pedido do Lucas,
// 2026-11-26): leitura e controle de status pelo painel. A escrita
// das sugestões é dos agentes, pela rota /api/openbot/suggestions
// (com a chave deles); aqui o Lucas só lê, aprova, descarta, marca
// feita e remove, gravado no mesmo armazenamento interno (state.ts).
//   GET    /api/suggestions?slug=<slug>  -> da mais nova à mais antiga
//   PATCH  /api/suggestions { id, status } -> nova | aprovada |
//          descartada | feita
//   DELETE /api/suggestions { id } -> remove (usado também para
//          limpar sugestão de teste)
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!stateConfigured()) {
    return NextResponse.json({ ok: true, suggestions: [], configured: false });
  }
  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug") ?? "").trim();
  const locationId = (url.searchParams.get("location_id") ?? "").trim();
  const s = await getState(0);
  const list = s.suggestions
    .filter((x) => (slug ? x.slug === slug : locationId ? x.locationId === locationId : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return NextResponse.json({ ok: true, suggestions: list, configured: true });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const status = body?.status as SuggestionStatus;
  if (!id || !SUGGESTION_STATUSES.includes(status)) {
    return NextResponse.json(
      { ok: false, error: "id and a valid status (nova, aprovada, descartada, feita) are required" },
      { status: 400 },
    );
  }
  if (!stateConfigured()) {
    return NextResponse.json({ ok: false, error: "Internal storage is not configured yet" }, { status: 503 });
  }
  let updated: AgentSuggestion | null = null;
  try {
    await mutateState((s) => {
      const x = s.suggestions.find((v) => v.id === id);
      if (!x) return;
      // SET direto do alvo (não toggle): idempotente se a mutateState
      // reaplicar a função sobre um estado mais novo.
      x.status = status;
      x.updatedAt = new Date().toISOString();
      updated = { ...x };
    });
  } catch {
    return NextResponse.json({ ok: false, error: "The internal storage did not answer" }, { status: 502 });
  }
  if (!updated) {
    return NextResponse.json({ ok: false, error: "Suggestion not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, suggestion: updated });
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
      const before = s.suggestions.length;
      s.suggestions = s.suggestions.filter((x) => x.id !== id);
      removed = s.suggestions.length !== before;
    });
  } catch {
    return NextResponse.json({ ok: false, error: "The internal storage did not answer" }, { status: 502 });
  }
  if (!removed) {
    return NextResponse.json({ ok: false, error: "Suggestion not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
