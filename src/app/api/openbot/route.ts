import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { ACCOUNTS } from "@/lib/accounts";
import { appendLog, makeLogEntry } from "@/lib/state";
import { getAgencyAccessToken } from "@/lib/agency";

// PONTE DOS AGENTES DO OPENBOT (pedido do Lucas, 2026-11-26): os
// agentes precisam USAR as credenciais do HighLevel guardadas no
// Supabase Central de Clientes (public.credenciais, integração
// "Commander Center") sem nunca ver, copiar ou pedir um token.
//   POST /api/openbot
//   Header: x-openbot-key = env OPENBOT_AGENT_KEY (sem a env, 503:
//   a porta nunca fica aberta por engano).
//   Chave rotacionada em 2026-11-27 a pedido do Lucas: a cópia antiga
//   divergiu da env e passou a ser recusada; a nova vive na env de
//   produção e nos arquivos de comando dos agentes.
//   Body: { location_id, method, path, body? }
// O servidor lê o token da location direto do Supabase, chama a API
// do HighLevel com ele e devolve SÓ a resposta do HighLevel (JSON e
// status). O token nunca aparece na resposta, no log nem nos erros.
// Cada chamada deixa uma linha no log do painel (quem, o quê, status),
// sem nenhum segredo.
// MODO AGÊNCIA (2026-11-27): Body { mode: "agency", method, path,
// body? } (sem location_id) chama a API com o token de EMPRESA
// guardado no Supabase (public.agencia_conexao, ver src/lib/agency.ts
// e o callback em /api/openbot/agency/callback). Caminhos /saas/
// usam o header Version "v3"; os demais, "2021-07-28". Sem conexão
// de agência salva, 409; renovação do token com falha, 502.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HL_BASE = "https://services.leadconnectorhq.com";
const CACHE_TTL_MS = 60_000;
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const tokenCache = new Map<string, { token: string; cliente: string; at: number }>();

function bridgeError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function keyOk(provided: string | null): boolean {
  const expected = process.env.OPENBOT_AGENT_KEY;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Token da location lido do Supabase na hora (cache de 60s, igual ao pit.ts). */
async function tokenForLocation(
  locationId: string,
): Promise<{ token: string; cliente: string } | null> {
  const hit = tokenCache.get(locationId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const q =
    "select=token,cliente&servico=eq.HighLevel" +
    `&location_id=eq.${encodeURIComponent(locationId)}` +
    "&integracao_nome=eq.Commander%20Center&limit=1";
  const res = await fetch(`${url}/rest/v1/credenciais?${q}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as { token?: string; cliente?: string }[];
  const token = rows?.[0]?.token;
  if (!token) return null;
  const entry = { token, cliente: rows[0].cliente ?? "", at: Date.now() };
  tokenCache.set(locationId, entry);
  return entry;
}

function validPath(p: unknown): p is string {
  if (typeof p !== "string") return false;
  if (p.length < 2 || p.length > 2000) return false;
  if (!p.startsWith("/") || p.startsWith("//")) return false;
  if (p.includes("..") || p.includes("\\") || /[\s\x00-\x1f]/.test(p)) return false;
  return true;
}

async function logBridge(
  locationId: string,
  cliente: string,
  method: string,
  path: string,
  status: number,
): Promise<void> {
  const a = ACCOUNTS.find((x) => x.locationId === locationId);
  const cleanPath = path.split("?")[0].slice(0, 160);
  await appendLog(
    makeLogEntry({
      slug: a?.slug ?? "openbot",
      account: a?.name ?? cliente ?? locationId,
      action: "agent",
      by: "OpenBot bridge",
      kind: "log",
      status: "completed",
      title: `OpenBot bridge: ${method} ${cleanPath} -> ${status}`.slice(0, 300),
    }),
  );
}

/** Chamada em modo agência: token de empresa do Supabase, sem location. */
async function agencyCall(method: string, path: string, body: unknown) {
  const tok = await getAgencyAccessToken();
  if (!tok.ok) {
    if (tok.reason === "not_connected") {
      return bridgeError(409, "Agency is not connected yet");
    }
    return bridgeError(502, "Agency token refresh failed");
  }

  // A API de SaaS (v3) exige Version "v3"; o resto segue em 2021-07-28.
  const version = path.startsWith("/saas/") ? "v3" : "2021-07-28";
  let hlStatus = 0;
  let hlData: unknown = null;
  try {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${tok.accessToken}`,
        Version: version,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    };
    if (body !== undefined && method !== "GET") {
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${HL_BASE}${path}`, init);
    hlStatus = res.status;
    const text = await res.text();
    try {
      hlData = text ? JSON.parse(text) : null;
    } catch {
      hlData = { raw: text.slice(0, 2000) };
    }
  } catch {
    await logBridge("agency", "Agência HighLevel", method, path, 0);
    return bridgeError(502, "HighLevel did not answer");
  }

  await logBridge("agency", "Agência HighLevel", method, path, hlStatus);
  return NextResponse.json(hlData ?? {}, { status: hlStatus });
}

export async function POST(req: Request) {
  const expected = process.env.OPENBOT_AGENT_KEY;
  if (!expected) return bridgeError(503, "Bridge is not configured");
  if (!keyOk(req.headers.get("x-openbot-key"))) {
    return bridgeError(401, "Invalid agent key");
  }

  const payload = (await req.json().catch(() => null)) as
    | {
        mode?: unknown;
        location_id?: unknown;
        method?: unknown;
        path?: unknown;
        body?: unknown;
      }
    | null;

  const method = typeof payload?.method === "string" ? payload.method.toUpperCase() : "";
  const path = payload?.path;

  if (payload?.mode === "agency") {
    if (!METHODS.has(method)) {
      return bridgeError(400, "method must be GET, POST, PUT, PATCH or DELETE");
    }
    if (!validPath(path)) {
      return bridgeError(400, "path must be a HighLevel API path starting with /");
    }
    return agencyCall(method, path, payload?.body);
  }

  const locationId = typeof payload?.location_id === "string" ? payload.location_id.trim() : "";

  if (!locationId) return bridgeError(400, "location_id is required");
  if (!METHODS.has(method)) return bridgeError(400, "method must be GET, POST, PUT, PATCH or DELETE");
  if (!validPath(path)) return bridgeError(400, "path must be a HighLevel API path starting with /");

  const cred = await tokenForLocation(locationId);
  if (!cred) return bridgeError(404, "Unknown location_id or no Commander Center credential stored");

  let hlStatus = 0;
  let hlData: unknown = null;
  try {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${cred.token}`,
        Version: "2021-07-28",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    };
    if (payload?.body !== undefined && method !== "GET") {
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
      init.body = JSON.stringify(payload.body);
    }
    const res = await fetch(`${HL_BASE}${path}`, init);
    hlStatus = res.status;
    const text = await res.text();
    try {
      hlData = text ? JSON.parse(text) : null;
    } catch {
      hlData = { raw: text.slice(0, 2000) };
    }
  } catch {
    await logBridge(locationId, cred.cliente, method, path, 0);
    return bridgeError(502, "HighLevel did not answer");
  }

  await logBridge(locationId, cred.cliente, method, path, hlStatus);
  return NextResponse.json(hlData ?? {}, { status: hlStatus });
}
