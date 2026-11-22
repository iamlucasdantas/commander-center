import { NextResponse } from "next/server";
import { getAnalytics, ingestAnalytics, type AnalyticsState } from "@/lib/analytics";

// Ingest dos snapshots de analytics (GA4, Search Console, redes
// sociais e YouTube), gravados pelo coletor que roda no ambiente da
// Muse (os conectores e o Composio não rodam no Vercel). Autenticação
// por segredo compartilhado no header x-collector-secret, comparado
// com a env COLLECTOR_SECRET. Sem o segredo, 401: este endpoint nunca
// fica aberto.
//
// POST: corpo parcial de AnalyticsState (sites/social/youtube); a
// fusão é por chave, ver ingestAnalytics em lib/analytics.ts.
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
  let payload: Partial<AnalyticsState>;
  try {
    payload = (await req.json()) as Partial<AnalyticsState>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const state = await ingestAnalytics(payload);
  return NextResponse.json({
    ok: true,
    sites: Object.keys(state.sites).length,
    socialCards: state.social?.cards.length ?? 0,
    youtube: Object.keys(state.youtube ?? {}),
  });
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const state = await getAnalytics(0);
  const sites: Record<string, string> = {};
  for (const [k, v] of Object.entries(state.sites)) sites[k] = v.collectedAt;
  return NextResponse.json({
    ok: true,
    sites,
    social: state.social?.collectedAt ?? null,
    youtube: Object.fromEntries(
      Object.entries(state.youtube ?? {}).map(([k, v]) => [k, v.collectedAt]),
    ),
  });
}
