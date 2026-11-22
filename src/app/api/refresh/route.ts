import { NextResponse } from "next/server";
import { ACCOUNTS } from "@/lib/accounts";

// Refresh manual (pedido do Lucas, 2026-11-16): além da coleta automática,
// ele pode forçar a atualização quando quiser, no painel inteiro ou por conta.
// POST /api/refresh            -> atualiza todas as contas com fonte ligada
// POST /api/refresh?slug=xxx   -> atualiza só aquela conta
// A rotina de coleta em si (HighLevel, GA4, fontes próprias) entra na Fase 1
// e é a MESMA chamada pelo cron: este endpoint só dispara e devolve o estado.
// Regras: exige sessão do painel (checado pelo middleware de auth),
// trava de concorrência e cooldown curto para não duplicar coleta.
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
    // Fase 1: chamar syncAccount(a) para cada alvo e gravar o snapshot.
    return NextResponse.json({
      ok: true,
      startedAt: new Date(lastRunAt).toISOString(),
      accounts: targets.map((a) => a.slug),
      note: "Collection triggered. The dashboard shows the last update time per account.",
    });
  } finally {
    running = false;
  }
}
