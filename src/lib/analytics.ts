// Snapshots de analytics que NÃO vêm do HighLevel: GA4 e Search
// Console (via Composio), redes sociais (Instagram, Threads e Páginas
// do Facebook, via conectores) e YouTube do SAAZID (via Composio).
//
// Arquitetura (plano da Fase 3 + ordem do Lucas, 2026-11-22): os CLIs
// e o Composio rodam no ambiente da Muse, não no Vercel. Um coletor
// do lado da Muse lê essas fontes e grava os snapshots aqui, via
// POST /api/collector/ingest (protegido pelo COLLECTOR_SECRET). O
// painel só LÊ este documento. Documento próprio no Blob,
// `analytics-state.json`, separado do panel-state.json para a coleta
// externa nunca disputar escrita com as ações do painel.
//
// Regra de honestidade: snapshot ausente ou fonte vazia aparece na
// tela como pendência ("sem fonte de analytics", "GA4 conectado, sem
// dados no período"), nunca como número inventado.

import { get, put } from "@vercel/blob";

export interface Ga4Snapshot {
  sessions28: number;
  users28: number;
  views28: number;
  sessionsPrev28: number;
  usersPrev28: number;
  viewsPrev28: number;
  /** Sessões por dia, últimos 28 dias, do mais antigo ao mais novo. */
  byDay: number[];
  channels: { name: string; sessions: number }[];
  /** Quantas propriedades GA4 foram somadas neste número. */
  properties: number;
  /** false quando o GA4 respondeu, mas sem nenhuma linha no período. */
  hasData: boolean;
}

export interface GscSnapshot {
  clicks28: number;
  impressions28: number;
  ctr28: number; // 0..1
  position28: number;
  topQueries: { query: string; clicks: number; impressions: number; position: number }[];
  /** Quantos sites (domínios) foram somados. */
  sites: number;
}

export interface SiteSnapshot {
  collectedAt: string; // ISO
  ga4?: Ga4Snapshot;
  gsc?: GscSnapshot;
}

export interface SocialCard {
  network: "instagram" | "threads" | "facebook";
  /** @handle ou nome da Página. */
  handle: string;
  /** Marca dona do cartão (agrupamento na página Social). */
  brand: string;
  /** Conta do painel à qual a marca pertence, quando existe. */
  accountSlug?: string;
  followers: number | null;
  followersDelta28: number | null;
  views28: number | null;
  interactions28: number | null;
  profileVisits28: number | null;
  note?: string;
}

export interface SocialSnapshot {
  collectedAt: string; // ISO
  cards: SocialCard[];
}

export interface YoutubeVideo {
  id: string;
  title: string;
  publishedAt: string; // ISO
  views: number | null;
  likes: number | null;
  comments: number | null;
  thumb: string | null;
}

export interface YoutubeSnapshot {
  collectedAt: string; // ISO
  channelId: string;
  handle: string;
  title: string;
  subscribers: number | null;
  totalViews: number | null;
  videoCount: number | null;
  recentVideos: YoutubeVideo[];
  /** Pontos diários para os deltas de 7d/30d (um por dia de coleta). */
  history: { date: string; subscribers: number | null; totalViews: number | null }[];
  /** Erro da última tentativa (ex.: cota da API), quando houve. */
  error?: string;
}

export interface AnalyticsState {
  sites: Record<string, SiteSnapshot>;
  social?: SocialSnapshot;
  youtube?: Record<string, YoutubeSnapshot>;
}

const ANALYTICS_PATH = "analytics-state.json";

function emptyAnalytics(): AnalyticsState {
  return { sites: {} };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function normalize(raw: unknown): AnalyticsState {
  const s = emptyAnalytics();
  if (!isObj(raw)) return s;
  if (isObj(raw.sites)) {
    for (const [k, v] of Object.entries(raw.sites)) {
      if (isObj(v) && typeof v.collectedAt === "string") s.sites[k] = v as unknown as SiteSnapshot;
    }
  }
  if (isObj(raw.social) && Array.isArray(raw.social.cards)) {
    s.social = raw.social as unknown as SocialSnapshot;
  }
  if (isObj(raw.youtube)) {
    s.youtube = {};
    for (const [k, v] of Object.entries(raw.youtube)) {
      if (isObj(v) && typeof v.collectedAt === "string") s.youtube[k] = v as unknown as YoutubeSnapshot;
    }
  }
  return s;
}

export function analyticsConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readRemote(): Promise<AnalyticsState> {
  if (!analyticsConfigured()) return emptyAnalytics();
  try {
    const res = await get(ANALYTICS_PATH, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return emptyAnalytics();
    const text = await new Response(res.stream).text();
    return normalize(JSON.parse(text));
  } catch {
    return emptyAnalytics();
  }
}

let memCache: { at: number; state: AnalyticsState } | null = null;
const MEM_TTL_MS = 60_000;

/** Estado atual dos snapshots; maxAgeMs 0 força leitura fresca. */
export async function getAnalytics(maxAgeMs = MEM_TTL_MS): Promise<AnalyticsState> {
  if (memCache && Date.now() - memCache.at < maxAgeMs) return memCache.state;
  const s = await readRemote();
  memCache = { at: Date.now(), state: s };
  return s;
}

/**
 * Grava a coleta nova por cima da anterior, com a mesma disciplina do
 * panel-state: confere um nonce após escrever e tenta de novo se outra
 * escrita atropelar. A fusão é por chave: sites por slug, social
 * inteiro, youtube por slug (com o histórico preservado e o ponto do
 * dia acrescentado).
 */
export async function ingestAnalytics(payload: Partial<AnalyticsState>): Promise<AnalyticsState> {
  let last = await readRemote();
  for (let attempt = 0; attempt < 3; attempt++) {
    const working = normalize(JSON.parse(JSON.stringify(last)));
    if (payload.sites) {
      for (const [k, v] of Object.entries(payload.sites)) {
        if (!v) continue;
        // Fusão por sub-bloco: uma coleta parcial (só GA4 ou só GSC)
        // não pode apagar o bloco que ela não coletou.
        const prev = working.sites[k];
        working.sites[k] = {
          collectedAt: v.collectedAt,
          ga4: v.ga4 ?? prev?.ga4,
          gsc: v.gsc ?? prev?.gsc,
        };
      }
    }
    if (payload.social) working.social = payload.social;
    if (payload.youtube) {
      working.youtube = working.youtube ?? {};
      for (const [k, v] of Object.entries(payload.youtube)) {
        if (!v) continue;
        const prev: YoutubeSnapshot | undefined = working.youtube[k];
        const history: YoutubeSnapshot["history"] = [...(prev?.history ?? [])];
        const today = v.collectedAt.slice(0, 10);
        const point = { date: today, subscribers: v.subscribers, totalViews: v.totalViews };
        const idx = history.findIndex((h) => h.date === today);
        if (v.subscribers !== null || v.totalViews !== null) {
          if (idx >= 0) history[idx] = point;
          else history.push(point);
        }
        working.youtube[k] = {
          ...v,
          // Se a coleta de hoje falhou (erro de cota), mantém os
          // últimos vídeos conhecidos em vez de apagar a lista.
          recentVideos: v.recentVideos.length ? v.recentVideos : prev?.recentVideos ?? [],
          subscribers: v.subscribers ?? prev?.subscribers ?? null,
          totalViews: v.totalViews ?? prev?.totalViews ?? null,
          videoCount: v.videoCount ?? prev?.videoCount ?? null,
          history: history.slice(-90),
        };
      }
    }
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await put(ANALYTICS_PATH, JSON.stringify({ ...working, _nonce: nonce }), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    const back = await readRemote();
    memCache = { at: Date.now(), state: back };
    if ((back as AnalyticsState & { _nonce?: string })._nonce === nonce) return back;
    last = back;
  }
  return last;
}

/** Delta entre o valor atual e o ponto do histórico de N dias atrás. */
export function historyDelta(
  snap: YoutubeSnapshot,
  days: number,
  field: "subscribers" | "totalViews",
): number | null {
  const cur = snap[field];
  if (cur === null) return null;
  const cutoff = Date.now() - days * 86_400_000;
  const points = snap.history.filter((h) => h[field] !== null);
  if (points.length === 0) return null;
  // Ponto mais antigo que já passou do corte; sem ele, usa o primeiro.
  const base = [...points].reverse().find((h) => new Date(h.date).getTime() <= cutoff) ?? points[0];
  if (base === points[points.length - 1] && points.length < 2) return null;
  const b = base[field];
  return b === null ? null : cur - b;
}
