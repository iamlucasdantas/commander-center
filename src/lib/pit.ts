import type { Account } from "./accounts";

// Single source of truth for HighLevel subaccount tokens (Lucas, 2026-11-26):
// the token lives in the Supabase "Central de Clientes" table public.credenciais
// (integracao_nome = "Commander Center"), one row per location. The panel reads
// it from there; the Vercel env var (account.pitEnv) stays as a fallback.
// Rotating a token = updating the row in Supabase; the panel picks it up
// within the cache TTL below, no redeploy needed.

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { token: string; at: number }>();

/** True when a token resolves for the account (Supabase first, env fallback). Never exposes the value. */
export async function hasResolvedToken(a: Account): Promise<boolean> {
  return Boolean(await getPitToken(a));
}

export async function getPitToken(a: Account): Promise<string | undefined> {
  const fallback = a.pitEnv ? process.env[a.pitEnv] : undefined;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !a.locationId) return fallback;

  const hit = cache.get(a.locationId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.token;

  try {
    const q =
      "select=token&servico=eq.HighLevel" +
      `&location_id=eq.${encodeURIComponent(a.locationId)}` +
      "&integracao_nome=eq.Commander%20Center&limit=1";
    const res = await fetch(`${url}/rest/v1/credenciais?${q}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (res.ok) {
      const rows = (await res.json()) as { token?: string }[];
      const token = rows?.[0]?.token;
      if (token) {
        cache.set(a.locationId, { token, at: Date.now() });
        return token;
      }
    }
  } catch {
    // Supabase unreachable: fall back to the env var below.
  }
  return fallback;
}
