import { NextResponse } from "next/server";
import { getAnalytics, ingestAnalytics, type AnalyticsState } from "@/lib/analytics";
import { getCommand, ingestCommand, type CommandState } from "@/lib/command";

// Ingest dos snapshots gravados pelos coletores que rodam no
// ambiente da Muse (os conectores e o Composio não rodam no
// Vercel): analytics (GA4, Search Console, redes sociais e YouTube)
// e a central de comando (agenda e Vercel, unificação de 2026-11-22).
// Autenticação por segredo compartilhado no header
// x-collector-secret, comparado com a env COLLECTOR_SECRET. Sem o
// segredo, 401: este endpoint nunca fica aberto.
//
// POST: corpo parcial; sites/social/youtube vão para o
// analytics-state.json (fusão por chave, ver lib/analytics.ts) e
// agenda/vercel vão para o command-state.json (ver lib/command.ts).
// GET: resumo do que já foi coletado (datas por seção), para o
// coletor conferir a própria gravação. Nenhum dado sensível sai daqui.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.COLLECTOR_SECRET;
  if (!secret) return false;
  return req.headers.get("x-collector-secret") === secret;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let payload: Partial<AnalyticsState> & Partial<CommandState>;
  try {
    payload = (await req.json()) as Partial<AnalyticsState> & Partial<CommandState>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const { agenda, vercel, ...analyticsPayload } = payload;
  const state = await ingestAnalytics(analyticsPayload);
  let command: CommandState | null = null;
  if (agenda || vercel) {
    command = await ingestCommand({ agenda, vercel });
  }
  return NextResponse.json({
    ok: true,
    sites: Object.keys(state.sites).length,
    socialCards: state.social?.cards.length ?? 0,
    youtube: Object.keys(state.youtube ?? {}),
    agenda: command?.agenda ? { collectedAt: command.agenda.collectedAt, events: command.agenda.events.length } : undefined,
    vercel: command?.vercel ? { collectedAt: command.vercel.collectedAt, projects: command.vercel.projects.length } : undefined,
  });
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const state = await getAnalytics(0);
  const command = await getCommand(0);
  const sites: Record<string, string> = {};
  for (const [k, v] of Object.entries(state.sites)) sites[k] = v.collectedAt;
  return NextResponse.json({
    ok: true,
    sites,
    social: state.social?.collectedAt ?? null,
    youtube: Object.fromEntries(
      Object.entries(state.youtube ?? {}).map(([k, v]) => [k, v.collectedAt]),
    ),
    agenda: command.agenda?.collectedAt ?? null,
    vercel: command.vercel?.collectedAt ?? null,
  });
}
