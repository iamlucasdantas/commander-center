// Reputação no Google (avaliações do Google Business Profile), por
// conta. Pedido do Lucas em 2026-11-25: Corazon Latino, Simpson Ltd,
// Pee Wee's, Mi Rancho e outras têm gestão de reputação ou KPI de
// avaliações no contrato, e o painel só mostrava a pendência, porque
// o HighLevel não expõe avaliações à chave PIT (ver services.ts,
// PEND_REPUTATION).
//
// Fonte: Google Business Profile API, lida pelo Composio (toolkit
// google_business_profile) por um coletor que roda num agente do
// OpenBot e grava aqui via POST /api/collector/ingest (seção
// `reputation`, fundida por slug em analytics.ts) ou pela ferramenta
// `ingest_reputation` do endpoint MCP (/api/mcp). O painel só LÊ.
//
// Regra de honestidade do painel: sem snapshot, a tela continua
// mostrando a pendência; nada aqui estima número nenhum.

export interface ReputationReview {
  /** Nome do avaliador como o Google mostra. */
  name: string;
  rating: number; // 1..5
  /** ISO da avaliação. */
  when: string;
  /** Trecho curto do comentário (até 160 caracteres), vazio quando não há texto. */
  excerpt: string;
  /** Link da avaliação ou do perfil, quando a fonte dá. */
  url?: string;
}

export interface ReputationSnapshot {
  collectedAt: string; // ISO
  /** Resource name do GBP: accounts/{id}/locations/{id}. */
  gbpLocation: string;
  /** Título da location no Google. */
  title?: string;
  /** Total de avaliações do perfil e média atual (0..5, uma casa). */
  totalReviews: number;
  averageRating: number | null;
  /** Avaliações novas nos últimos 30 dias e nos 30 anteriores. */
  new30: number;
  newPrev30: number;
  /** Do total: com resposta do negócio e sem resposta. */
  replied: number;
  unreplied: number;
  /** Respostas publicadas nos últimos 30 dias (trabalho de gestão de reputação). */
  repliedLast30: number;
  /** Horas médias entre a avaliação e a resposta, nas respondidas dos últimos 90 dias. */
  avgReplyHours: number | null;
  /** Avaliações de 1 ou 2 estrelas ainda sem resposta (até 5, mais recentes primeiro). */
  negativeUnreplied: ReputationReview[];
  /** Métricas de desempenho do GBP nos últimos 30 dias, quando a API deu. */
  calls30?: number | null;
  websiteClicks30?: number | null;
  directions30?: number | null;
  /** Um ponto por dia de coleta, para os deltas. */
  history: { date: string; totalReviews: number; averageRating: number | null; unreplied: number }[];
  /** Erro da última tentativa (ex.: location não verificada), quando houve. */
  error?: string;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Aceita o corpo cru do coletor e devolve um snapshot bem formado, ou null. */
export function normalizeReputation(raw: unknown): ReputationSnapshot | null {
  if (!isObj(raw) || typeof raw.collectedAt !== "string" || typeof raw.gbpLocation !== "string") return null;
  const reviews: ReputationReview[] = Array.isArray(raw.negativeUnreplied)
    ? raw.negativeUnreplied
        .filter(isObj)
        .map((r) => ({
          name: typeof r.name === "string" ? r.name.slice(0, 80) : "Reviewer",
          rating: Math.min(5, Math.max(1, num(r.rating, 1))),
          when: typeof r.when === "string" ? r.when : "",
          excerpt: typeof r.excerpt === "string" ? r.excerpt.slice(0, 160) : "",
          url: typeof r.url === "string" ? r.url : undefined,
        }))
        .slice(0, 5)
    : [];
  const history = Array.isArray(raw.history)
    ? raw.history
        .filter(isObj)
        .filter((h) => typeof h.date === "string")
        .map((h) => ({
          date: h.date as string,
          totalReviews: num(h.totalReviews),
          averageRating: numOrNull(h.averageRating),
          unreplied: num(h.unreplied),
        }))
    : [];
  return {
    collectedAt: raw.collectedAt,
    gbpLocation: raw.gbpLocation,
    title: typeof raw.title === "string" ? raw.title : undefined,
    totalReviews: num(raw.totalReviews),
    averageRating: numOrNull(raw.averageRating),
    new30: num(raw.new30),
    newPrev30: num(raw.newPrev30),
    replied: num(raw.replied),
    unreplied: num(raw.unreplied),
    repliedLast30: num(raw.repliedLast30),
    avgReplyHours: numOrNull(raw.avgReplyHours),
    negativeUnreplied: reviews,
    calls30: numOrNull(raw.calls30),
    websiteClicks30: numOrNull(raw.websiteClicks30),
    directions30: numOrNull(raw.directions30),
    history,
    error: typeof raw.error === "string" ? raw.error : undefined,
  };
}

/** Funde a coleta nova com a anterior: histórico preservado, ponto do dia acrescentado. */
export function mergeReputation(prev: ReputationSnapshot | undefined, next: ReputationSnapshot): ReputationSnapshot {
  const history = [...(prev?.history ?? [])];
  if (!next.error) {
    const today = next.collectedAt.slice(0, 10);
    const point = { date: today, totalReviews: next.totalReviews, averageRating: next.averageRating, unreplied: next.unreplied };
    const idx = history.findIndex((h) => h.date === today);
    if (idx >= 0) history[idx] = point;
    else history.push(point);
    return { ...next, history: history.slice(-180) };
  }
  // Coleta que falhou: mantém os últimos números bons e anota o erro.
  return prev ? { ...prev, collectedAt: next.collectedAt, error: next.error, history } : { ...next, history };
}

/** Delta do total de avaliações contra o ponto de N dias atrás, quando o histórico alcança. */
export function reputationDelta(snap: ReputationSnapshot, days: number): number | null {
  const cutoff = Date.now() - days * 86_400_000;
  const pts = snap.history;
  if (pts.length < 2) return null;
  const base = [...pts].reverse().find((h) => new Date(h.date).getTime() <= cutoff);
  if (!base) return null;
  return snap.totalReviews - base.totalReviews;
}

/** Frase curta para a lista de pendências e para os agentes. */
export function reputationLine(snap: ReputationSnapshot): string {
  const avg = snap.averageRating !== null ? `${snap.averageRating.toFixed(1)}★` : "no rating";
  return `${snap.totalReviews} Google reviews · ${avg} · ${snap.new30} new in 30 days · ${snap.unreplied} without reply`;
}
