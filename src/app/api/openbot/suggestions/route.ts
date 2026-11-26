import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { ACCOUNTS } from "@/lib/accounts";
import {
  appendLog, getState, makeLogEntry, makeSuggestion, mutateState, stateConfigured,
  type AgentSuggestion,
} from "@/lib/state";

// SUGESTÕES DOS AGENTES POR CLIENTE (pedido do Lucas, 2026-11-26):
// tudo que um agente sugerir FAZER para um cliente mora DENTRO do
// Commander Center, na página daquele cliente, como primeiro bloco:
// o que fazer, por que importa, o plano completo em markdown e o
// prompt de execução pronto para o Lucas copiar e colar no agente
// responsável. Na segunda de manhã ele abre o cliente e despacha.
//
//   POST /api/openbot/suggestions
//   Header: x-openbot-key = env OPENBOT_AGENT_KEY (a mesma chave da
//   ponte /api/openbot; sem a env, 503: a porta nunca fica aberta).
//   Body (JSON):
//     {
//       "location_id": "uBtKBbMsYRoMDDQbRYor",   // obrigatório
//       "agent": "SEO",                            // obrigatório
//       "title": "O que fazer",                    // obrigatório
//       "why": "Por que importa",                  // obrigatório
//       "plan_md": "# Plano completo...",          // obrigatório
//       "prompt": "Prompt pronto para o agente"    // obrigatório
//     }
//   Sugestão sem plano completo e sem prompt é RECUSADA (400): a
//   regra do Lucas é que ele só aprova e despacha, nunca escreve o
//   plano. O location_id é validado contra a lista de clientes do
//   painel E contra a tabela public.credenciais do Supabase (precisa
//   existir a linha da integração "Commander Center"); nenhum token
//   é lido nem devolvido aqui (a consulta nem seleciona a coluna).
//   GET /api/openbot/suggestions?location_id=... devolve as
//   sugestões daquele cliente, da mais nova à mais antiga, para o
//   agente conferir antes de sugerir de novo e não duplicar.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function err(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function keyOk(provided: string | null): boolean {
  const expected = process.env.OPENBOT_AGENT_KEY;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function auth(req: Request): NextResponse | null {
  if (!process.env.OPENBOT_AGENT_KEY) return err(503, "Agent endpoint is not configured");
  if (!keyOk(req.headers.get("x-openbot-key"))) return err(401, "Invalid agent key");
  return null;
}

function cleanText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

/**
 * Confere no Supabase Central de Clientes se existe a credencial
 * "Commander Center" da location, SEM selecionar a coluna do token:
 * devolve só o nome do cliente gravado na linha.
 */
async function credentialClientName(locationId: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const q =
      "select=cliente&servico=eq.HighLevel" +
      `&location_id=eq.${encodeURIComponent(locationId)}` +
      "&integracao_nome=eq.Commander%20Center&limit=1";
    const res = await fetch(`${url}/rest/v1/credenciais?${q}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { cliente?: string }[];
    return rows?.[0]?.cliente ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const denied = auth(req);
  if (denied) return denied;
  if (!stateConfigured()) return err(503, "Internal storage is not configured yet");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const locationId = cleanText(body?.location_id, 80);
  const agent = cleanText(body?.agent, 60);
  const title = cleanText(body?.title, 300);
  const why = cleanText(body?.why, 2000);
  const planMd = cleanText(body?.plan_md, 20000);
  const prompt = cleanText(body?.prompt, 8000);

  if (!locationId) return err(400, "location_id is required");
  const account = ACCOUNTS.find((x) => x.locationId === locationId);
  if (!account) {
    return err(400, "Unknown location_id: it is not one of the Commander Center clients");
  }
  if (!agent) return err(400, "agent is required (your agent name, e.g. SEO)");
  if (title.length < 5) return err(400, "title is required (what to do, at least 5 characters)");
  if (why.length < 10) return err(400, "why is required (why it matters, at least 10 characters)");
  if (planMd.length < 40) {
    return err(400, "plan_md is incomplete: send the complete plan in markdown (steps and how to do it)");
  }
  if (prompt.length < 20) {
    return err(400, "prompt is incomplete: send the ready-to-paste execution prompt for the responsible agent");
  }

  const cliente = await credentialClientName(locationId);
  if (!cliente) {
    return err(404, "No Commander Center credential stored for this location_id");
  }

  const suggestion = makeSuggestion({
    locationId,
    slug: account.slug,
    agent,
    title,
    why,
    planMd,
    prompt,
  });
  try {
    await mutateState((s) => {
      // Idempotente: se a mutateState reaplicar a função, não duplica.
      if (!s.suggestions.some((x) => x.id === suggestion.id)) s.suggestions.push(suggestion);
    });
  } catch {
    return err(502, "The internal storage did not answer");
  }
  await appendLog(
    makeLogEntry({
      slug: account.slug,
      account: account.name,
      action: "agent",
      by: agent,
      kind: "log",
      status: "completed",
      title: `Nova sugestão do agente ${agent}: ${title}`.slice(0, 300),
    }),
  );
  return NextResponse.json({ ok: true, suggestion });
}

export async function GET(req: Request) {
  const denied = auth(req);
  if (denied) return denied;
  if (!stateConfigured()) return NextResponse.json({ ok: true, suggestions: [], configured: false });
  const url = new URL(req.url);
  const locationId = (url.searchParams.get("location_id") ?? "").trim();
  const slug = (url.searchParams.get("slug") ?? "").trim();
  const s = await getState(0);
  const list = s.suggestions
    .filter((x: AgentSuggestion) => (locationId ? x.locationId === locationId : slug ? x.slug === slug : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return NextResponse.json({ ok: true, suggestions: list, configured: true });
}
