// MODO AGÊNCIA DA PONTE DO OPENBOT (Lucas, 2026-11-27): token de
// EMPRESA (agency) do HighLevel, obtido por OAuth direto no app
// Marketplace dele, SEM passar pelo Composio (o OAuth do Composio só
// pedia os 8 escopos fixos dele, e locations/SaaS voltavam 401).
// O token fica guardado no Supabase Central de Clientes
// (public.agencia_conexao, linha id = "principal"), lido e escrito
// SÓ pelo servidor, com a service role. Nenhum agente vê o token, e
// ele nunca aparece em resposta, log ou erro.
// Client id/secret do app ficam em env da Vercel:
// OPENBOT_AGENCY_CLIENT_ID e OPENBOT_AGENCY_CLIENT_SECRET.
// Refresh: o HighLevel ROTACIONA o refresh token a cada uso (o novo
// invalida o antigo), então TODA renovação grava o access token E o
// refresh token novos. Perder o mais novo mata a conexão.

const HL_BASE = "https://services.leadconnectorhq.com";
const REFRESH_MARGIN_MS = 60_000;

export type AgencyRow = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  company_id: string | null;
  escopo: string | null;
  expires_at: string | null;
  atualizado_em: string | null;
};

export type AgencyTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: "not_connected" | "refresh_failed" };

function supabaseEnv(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/** Linha "principal" da conexão de agência (null se ainda não conectou). */
export async function loadAgencyRow(): Promise<AgencyRow | null> {
  const env = supabaseEnv();
  if (!env) return null;
  try {
    const q =
      "select=id,access_token,refresh_token,company_id,escopo,expires_at,atualizado_em" +
      "&id=eq.principal&limit=1";
    const res = await fetch(`${env.url}/rest/v1/agencia_conexao?${q}`, {
      headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as AgencyRow[];
    return rows?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Upsert da linha "principal" com os tokens atuais. */
export async function saveAgencyTokens(values: {
  access_token: string;
  refresh_token: string | null;
  company_id: string | null;
  escopo: string | null;
  expires_in: number;
}): Promise<boolean> {
  const env = supabaseEnv();
  if (!env) return false;
  try {
    const res = await fetch(`${env.url}/rest/v1/agencia_conexao`, {
      method: "POST",
      headers: {
        apikey: env.key,
        Authorization: `Bearer ${env.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([
        {
          id: "principal",
          access_token: values.access_token,
          refresh_token: values.refresh_token,
          company_id: values.company_id,
          escopo: values.escopo,
          expires_at: new Date(Date.now() + values.expires_in * 1000).toISOString(),
          atualizado_em: new Date().toISOString(),
        },
      ]),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  companyId?: string;
};

async function doRefresh(row: AgencyRow): Promise<AgencyTokenResult> {
  const clientId = process.env.OPENBOT_AGENCY_CLIENT_ID;
  const clientSecret = process.env.OPENBOT_AGENCY_CLIENT_SECRET;
  if (!clientId || !clientSecret || !row.refresh_token) {
    return { ok: false, reason: "refresh_failed" };
  }
  let data: TokenResponse | null = null;
  try {
    const res = await fetch(`${HL_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: row.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        user_type: "Company",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return { ok: false, reason: "refresh_failed" };
    data = (await res.json()) as TokenResponse;
  } catch {
    return { ok: false, reason: "refresh_failed" };
  }
  if (!data?.access_token) return { ok: false, reason: "refresh_failed" };

  // Rotação obrigatória: grava o refresh token NOVO (o antigo acabou
  // de ser invalidado pelo HighLevel). Se a gravação falhar, a
  // renovação inteira é tratada como falha, pra não seguir com um
  // token cuja renovação se perdeu.
  const saved = await saveAgencyTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? row.refresh_token,
    company_id: data.companyId ?? row.company_id,
    escopo: data.scope ?? row.escopo,
    expires_in: data.expires_in ?? 86399,
  });
  if (!saved) return { ok: false, reason: "refresh_failed" };
  return { ok: true, accessToken: data.access_token };
}

// Renovações serializadas: duas chamadas simultâneas dos agentes
// compartilham a MESMA renovação, senão a segunda apresentaria o
// refresh token que a primeira acabou de invalidar.
let refreshInFlight: Promise<AgencyTokenResult> | null = null;

/** Access token de empresa válido, renovando antes se preciso. */
export async function getAgencyAccessToken(): Promise<AgencyTokenResult> {
  const row = await loadAgencyRow();
  if (!row || !row.access_token) return { ok: false, reason: "not_connected" };

  const expiresMs = row.expires_at ? Date.parse(row.expires_at) : 0;
  if (expiresMs - Date.now() > REFRESH_MARGIN_MS) {
    return { ok: true, accessToken: row.access_token };
  }

  if (!refreshInFlight) {
    refreshInFlight = doRefresh(row).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}
