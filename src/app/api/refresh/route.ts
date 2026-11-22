import { NextResponse } from "next/server";
import { ACCOUNTS } from "@/lib/accounts";
import { sweepStaleDnd, type DndSweepResult } from "@/lib/hl";
import { makeLogEntry, mutateState, stateConfigured } from "@/lib/state";

// Refresh manual (pedido do Lucas, 2026-11-16): além da coleta automática,
// ele pode forçar a atualização quando quiser, no painel inteiro ou por conta.
// POST /api/refresh            -> atualiza todas as contas com fonte ligada
// POST /api/refresh?slug=xxx   -> atualiza só aquela conta
// A rotina de coleta em si (HighLevel, GA4, fontes próprias) entra na Fase 1
// e é a MESMA chamada pelo cron: este endpoint só dispara e devolve o estado.
// Regras: exige sessão do painel (checado pelo middleware de auth),
// trava de concorrência e cooldown curto para não duplicar coleta.
// A automação de DND roda junto (ver o POST): teto alto de duração
// porque a primeira rodada pode aplicar dezenas de DNDs por conta.
export const maxDuration = 300;
let lastRunAt = 0;
let running = false;
const COOLDOWN_MS = 60_000;

export async function POST(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug");
  const targets = ACCOUNTS.filter(
    (a) => a.sourceStatus === "hl-location" || a.sourceStatus === "propria",
  ).filter((a) => !slug || a.slug === slug);

  if (slug && targets.length === 0) {
    return NextResponse.json({ ok: false, error: "Account has no connected source to refresh" }, { status: 400 });
  }
  if (running) {
    return NextResponse.json({ ok: false, error: "A refresh is already running" }, { status: 409 });
  }
  if (Date.now() - lastRunAt < COOLDOWN_MS) {
    return NextResponse.json({ ok: false, error: "Refreshed less than a minute ago" }, { status: 429 });
  }

  running = true;
  lastRunAt = Date.now();
  try {
    // Automação de DND de 7 dias (regra do Lucas, 2026-11-22): o
    // refresh é um dos gatilhos do ciclo dela. Roda por conta, em
    // paralelo, com teto de 50 aplicações por conta, e devolve o
    // resumo de cada uma. As varreduras NÃO gravam o estado interno
    // (deferState): os registros de DND e as entradas de log de todas
    // as contas são gravados numa escrita só no fim, para as contas
    // em paralelo não atropelarem umas às outras no documento único
    // (na primeira execução, escritas simultâneas se perderam).
    const hlTargets = targets.filter((a) => a.sourceStatus === "hl-location");
    const dndSweep: DndSweepResult[] = await Promise.all(
      hlTargets.map(async (a) => {
        try {
          return await sweepStaleDnd(a, 50, { deferState: true });
        } catch {
          return { slug: a.slug, candidates: 0, applied: 0, appliedIds: [], appliedNames: [], remaining: 0 };
        }
      }),
    );
    const appliedResults = dndSweep.filter((r) => r.applied > 0);
    if (appliedResults.length > 0 && stateConfigured()) {
      const at = new Date().toISOString();
      const nameBySlug = new Map(hlTargets.map((a) => [a.slug, a.name]));
      try {
        await mutateState((s) => {
          for (const r of appliedResults) {
            const cur = new Map((s.dndApplied[r.slug] ?? []).map((rec) => [rec.id, rec]));
            for (const id of r.appliedIds) if (!cur.has(id)) cur.set(id, { id, at });
            s.dndApplied[r.slug] = [...cur.values()];
            s.log.push(makeLogEntry({
              slug: r.slug,
              account: nameBySlug.get(r.slug) ?? r.slug,
              action: "dnd-automation",
              kind: "log",
              status: "completed",
              title: `DND automation: ${r.applied} contact${r.applied === 1 ? "" : "s"} put on DND (unverified for 7+ days)`,
              detail: r.appliedNames.join(", ").slice(0, 4000),
            }));
          }
        });
      } catch { /* sem o registro interno, o dnd da API já garante a idempotência */ }
    }
    return NextResponse.json({
      ok: true,
      startedAt: new Date(lastRunAt).toISOString(),
      accounts: targets.map((a) => a.slug),
      dndSweep,
      note: "Collection triggered. The dashboard shows the last update time per account.",
    });
  } finally {
    running = false;
  }
}
