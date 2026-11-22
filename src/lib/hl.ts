// Coleta ao vivo do HighLevel (API v2) usando o PIT de cada location.
// Nada é gravado aqui: a leitura acontece na abertura do painel, com cache
// de 5 minutos, e some na tela. Histórico e snapshots entram na fase do
// banco próprio do Commander Center.
//
// Fase 2 (redesign estrutural): além dos contadores, a coleta monta as
// séries diárias de leads dos últimos 30 dias e dos 30 dias anteriores a
// partir das datas de criação dos contatos já buscados, e mede sinais de
// decisão: fila não lida com atividade recente e pipeline aberto parado.
// Essas séries alimentam sparklines, comparações e o "what changed" sem
// nenhuma chamada extra por conta.
import { FAKE_NAME_PATTERNS, type Account } from "./accounts";

const BASE = "https://services.leadconnectorhq.com";

export interface LeadItem {
  id: string;
  name: string;
  when: string;
  sourceLabel: string;
  emailOnly: boolean;
  manuallyVerified: boolean; // tag "lead-verified" aplicada à mão pelo Lucas
  email: string | null;
  phone: string | null;
}

export interface FakeItem {
  name: string;
  account: string;
  reason: string;
}

export interface AccountMetrics {
  slug: string;
  ok: boolean;
  fetchedAt: number;
  leadsToday: number;
  leadsYesterday: number;
  leads7d: number;
  leadsPrev7d: number;
  leads30d: number;
  leadsPrev30d: number;
  totalContacts: number;
  unread: number;
  unreadConversations: number;
  unreadHot7d: number; // conversas não lidas com atividade nos últimos 7 dias
  unreadHidden: number; // conversas esperando escondidas pela regra "só lead verificado"
  unreadHiddenUnknown: number; // dessas, quantas o contato nem está na janela coletada
  opportunitiesOpen: number;
  opportunitiesValue: number;
  oppStaleCount: number; // abertas sem movimento há 14+ dias
  oppStaleValue: number;
  oppNew7d: number; // abertas criadas nos últimos 7 dias
  oppNew7dValue: number;
  recentLeads: LeadItem[];
  fakes: FakeItem[];
  fakeCount30d: number; // total de fakes em 30d (a lista é limitada a 10)
  partnerHidden: number; // compradores Partner US$ 1 escondidos (só Magnetic Funnels US)
  sourceCounts: Record<string, number>; // composição de fontes dos leads limpos, 30d
  leadsByDay: number[]; // 14 dias, do mais antigo ao mais novo
  leadsByDay30: number[]; // últimos 30 dias, do mais antigo ao mais novo
  leadsByDayPrev30: number[]; // 30 dias anteriores, do mais antigo ao mais novo
}

export interface HLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  contactName?: string;
  name?: string;
  email?: string;
  phone?: string;
  source?: string;
  dateAdded?: string;
  type?: string;
  tags?: string[];
}

interface HLConversation {
  unreadCount?: number;
  lastMessageDate?: number;
  createdAt?: number;
  contactName?: string;
  contactId?: string;
  lastMessageBody?: string;
  lastMessageType?: string;
  lastMessageDirection?: string;
  type?: string;
}

interface HLOpportunity {
  name?: string;
  status?: string;
  monetaryValue?: number;
  pipelineStageId?: string;
  createdAt?: string;
  updatedAt?: string;
  lastStatusChangeAt?: string;
}

function contactName(c: HLContact): string {
  return (
    c.contactName ||
    c.name ||
    [c.firstName, c.lastName].filter(Boolean).join(" ") ||
    c.email ||
    "No name"
  );
}

function isFake(c: HLContact): boolean {
  const n = contactName(c).toLowerCase();
  return FAKE_NAME_PATTERNS.some((p) => n.includes(p));
}

function isEmailOnly(c: HLContact): boolean {
  const s = (c.source ?? "").toLowerCase();
  return !s || s.includes("email") || s.includes("inbound");
}

// ------------------------------------------------- compradores Partner US$ 1
// Regra do Lucas (2026-11-22): quem entra pelo plano Partner na conta
// Magnetic Funnels (US) NÃO é lead dessa conta e não pode aparecer nas
// listas, contagens ou métricas dela. Marcador sustentado pelos dados que
// a coleta já traz: o campo `source` do contato vem com o nome do
// formulário/página do Partner Plan ("Partner Plan - Magnetic Funnels
// Brasil"), visível em 8 dos 31 leads da semana de 22/11/2026 na página
// da conta. Classe separada, como os fakes, mas só nesta conta.
export const PARTNER_ACCOUNT_SLUG = "magnetic-funnels-us";
export const PARTNER_SEPARATED_TAG = "partner-usd1";

/** Marcador Partner Plan no `source` do contato, independente da conta. */
export function isPartnerPlanContact(c: HLContact): boolean {
  return (c.source ?? "").toLowerCase().includes("partner plan");
}

export function isPartnerBuyer(a: Account, c: HLContact): boolean {
  if (a.slug !== PARTNER_ACCOUNT_SLUG) return false;
  return isPartnerPlanContact(c);
}

// ------------------------------------------------------- classificação
// A classificação ÚNICA de contato do painel, usada pelas listas de
// leads, pela exclusão, pela verificação e (desde 2026-11-22) pelo
// filtro das conversas não lidas:
//   partner    -> comprador Partner US$ 1 (só Magnetic Funnels US)
//   verified   -> verificação MANUAL do Lucas: contato com a tag
//                 "lead-verified" no HighLevel é verificado em tudo,
//                 por cima da regra automática de origem
//   fake       -> nome casa com os padrões de fake (quarentena)
//   unverified -> origem é só email avulso (ou source vazio)
//   verified   -> origem real: form, calendar, chat, workflow etc.
export type ContactClass = "verified" | "unverified" | "fake" | "partner";

/** Tag que a verificação manual aplica no contato (rota /api/verify-contact). */
export const LEAD_VERIFIED_TAG = "lead-verified";

export function hasLeadVerifiedTag(c: HLContact): boolean {
  return (c.tags ?? []).includes(LEAD_VERIFIED_TAG);
}

export function classifyContact(a: Account, c: HLContact): ContactClass {
  if (isPartnerBuyer(a, c)) return "partner";
  if (hasLeadVerifiedTag(c)) return "verified";
  if (isFake(c)) return "fake";
  if (isEmailOnly(c)) return "unverified";
  return "verified";
}

/**
 * Conjunto de ids de contatos VERIFICADOS dentro da janela coletada.
 * Conversa cujo contato não está neste conjunto não entra em nenhuma
 * lista nem contador de não lidas (regra do Lucas, 2026-11-22: conversa
 * não lida só pode ser de lead verificado). Contato fora da janela de
 * 500 conta como não verificado.
 */
function verifiedContactIds(a: Account, contacts: HLContact[]): Set<string> {
  const ids = new Set<string>();
  for (const c of contacts) {
    if (classifyContact(a, c) === "verified") ids.add(c.id);
  }
  return ids;
}

/** Balde de origem para o donut de composição (30d). */
function sourceBucket(c: HLContact): string {
  const s = (c.source ?? "").toLowerCase();
  if (s.includes("form")) return "Form";
  if (s.includes("calendar")) return "Calendar";
  if (s.includes("chat")) return "Chat";
  if (s.includes("workflow")) return "Workflow";
  if (s.includes("survey")) return "Survey";
  if (s.includes("quiz")) return "Quiz";
  if (!s || s.includes("email") || s.includes("inbound")) return "Stray email";
  return "Other";
}

async function hlFetch(path: string, pit: string, fresh = false): Promise<unknown> {
  const init: RequestInit & { next?: { revalidate: number } } = {
    headers: {
      Authorization: `Bearer ${pit}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(9000),
  };
  // As rotas de ação (excluir, separar) leem sem cache: a classificação
  // precisa refletir o HighLevel agora, não a foto de 5 minutos.
  if (fresh) init.cache = "no-store";
  else init.next = { revalidate: 300 };
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`HL ${res.status}`);
  return res.json();
}

async function hlGet(path: string, pit: string): Promise<unknown> {
  return hlFetch(path, pit, false);
}

/**
 * Repete uma leitura que falhou por erro transitório de rede (socket
 * fechado, timeout, 5xx do HighLevel). Sem isto, UMA página lenta na
 * coleta paralela da home derrubava a conta inteira para a seção
 * "Not connected yet" naquela renderização, mesmo com a conta
 * coletando normalmente (foi o que o Lucas viu com a Simpson Ltd em
 * 2026-11-22). Páginas já lidas voltam do cache de 5 minutos, então a
 * nova tentativa é barata.
 */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

function emptyMetrics(slug: string): AccountMetrics {
  return {
    slug, ok: false, fetchedAt: 0, leadsToday: 0, leadsYesterday: 0,
    leads7d: 0, leadsPrev7d: 0, leads30d: 0, leadsPrev30d: 0,
    totalContacts: 0, unread: 0, unreadConversations: 0, unreadHot7d: 0,
    unreadHidden: 0, unreadHiddenUnknown: 0,
    opportunitiesOpen: 0, opportunitiesValue: 0,
    oppStaleCount: 0, oppStaleValue: 0, oppNew7d: 0, oppNew7dValue: 0,
    recentLeads: [], fakes: [], fakeCount30d: 0, partnerHidden: 0, sourceCounts: {},
    leadsByDay: Array(14).fill(0),
    leadsByDay30: Array(30).fill(0),
    leadsByDayPrev30: Array(30).fill(0),
  };
}

/** Busca os contatos recentes da location (até 5 páginas, janela de 60 dias). */
async function fetchContacts(a: Account, pit: string, now: number, fresh = false): Promise<{ contacts: HLContact[]; total: number }> {
  const day = 86_400_000;
  const contacts: HLContact[] = [];
  let total = 0;
  // Até 5 páginas (500 contatos mais recentes) para fechar a janela de
  // 60 dias nas contas grandes. Para cedo se uma página inteira já está
  // fora da janela (a lista vem da mais recente para a mais antiga).
  for (let page = 1; page <= 5; page++) {
    const data = (await hlFetch(`/contacts/?locationId=${a.locationId}&limit=100&page=${page}`, pit, fresh)) as {
      contacts?: HLContact[];
      meta?: { total?: number; nextPage?: number | null };
    };
    const batch = data.contacts ?? [];
    contacts.push(...batch);
    total = data.meta?.total ?? contacts.length;
    if (!data.meta?.nextPage || batch.length === 0) break;
    const batchTimes = batch.map((c) => new Date(c.dateAdded ?? 0).getTime()).filter((t) => t > 0);
    if (batchTimes.length && Math.max(...batchTimes) < now - 60 * day) break;
  }
  contacts.sort((x, y) => new Date(y.dateAdded ?? 0).getTime() - new Date(x.dateAdded ?? 0).getTime());
  return { contacts, total };
}

interface ContactScan {
  m: AccountMetrics; // só os campos derivados de contatos; conversa/oportunidade zerados
  weekLeads: LeadItem[]; // TODOS os leads limpos dos últimos 7 dias, do mais novo ao mais antigo
  fakesAll: FakeItem[]; // quarentena da conta em 30d (até 30 itens)
  partnerTotal: number; // compradores Partner US$ 1 na janela buscada (só Magnetic Funnels US)
  partnerSeparated: number; // desses, quantos já têm a tag de separação no HighLevel
}

/** Deriva contadores, séries e listas a partir dos contatos já buscados. */
function scanContacts(a: Account, contacts: HLContact[], total: number, now: number): ContactScan {
  const day = 86_400_000;
  const m: AccountMetrics = {
    ...emptyMetrics(a.slug), ok: true, fetchedAt: now, totalContacts: total,
    leadsByDay: Array(14).fill(0), leadsByDay30: Array(30).fill(0), leadsByDayPrev30: Array(30).fill(0),
  };
  const weekLeads: LeadItem[] = [];
  const fakesAll: FakeItem[] = [];
  let partnerTotal = 0;
  let partnerSeparated = 0;
  for (const c of contacts) {
    const t = new Date(c.dateAdded ?? 0).getTime();
    if (!t) continue;
    const age = now - t;
    const ageDays = Math.floor(age / day);
    // Comprador Partner US$ 1: classe separada, fora de TODAS as métricas
    // e listas de leads desta conta (regra do Lucas, 2026-11-22).
    if (isPartnerBuyer(a, c)) {
      m.partnerHidden++;
      partnerTotal++;
      if ((c.tags ?? []).includes(PARTNER_SEPARATED_TAG)) partnerSeparated++;
      continue;
    }
    const fake = isFake(c);
    if (fake) {
      if (age < 30 * day) {
        m.fakeCount30d++;
        const item: FakeItem = { name: contactName(c), account: a.name, reason: "company/service name, stray email" };
        if (m.fakes.length < 10) m.fakes.push(item);
        if (fakesAll.length < 30) fakesAll.push(item);
      }
      continue;
    }
    if (age < 30 * day) {
      const b = sourceBucket(c);
      m.sourceCounts[b] = (m.sourceCounts[b] ?? 0) + 1;
    }
    if (age < day) m.leadsToday++;
    if (ageDays === 1) m.leadsYesterday++;
    if (age < 7 * day) m.leads7d++;
    if (age >= 7 * day && age < 14 * day) m.leadsPrev7d++;
    if (age < 30 * day) m.leads30d++;
    if (age >= 30 * day && age < 60 * day) m.leadsPrev30d++;
    if (ageDays >= 0 && ageDays < 30) m.leadsByDay30[29 - ageDays]++;
    if (ageDays >= 30 && ageDays < 60) m.leadsByDayPrev30[59 - ageDays]++;
    if (age < 7 * day) {
      const tagged = hasLeadVerifiedTag(c);
      const item: LeadItem = {
        id: c.id,
        name: contactName(c),
        when: new Date(t).toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago" }),
        sourceLabel: c.source || (isEmailOnly(c) ? "stray email" : "no source"),
        // Verificação manual vence a origem: quem tem a tag conta como
        // verificado nas listas e nos filtros (regra do Lucas, 2026-11-22).
        emailOnly: isEmailOnly(c) && !tagged,
        manuallyVerified: tagged,
        email: c.email ?? null,
        phone: c.phone ?? null,
      };
      weekLeads.push(item);
      if (m.recentLeads.length < 8) m.recentLeads.push(item);
    }
  }
  m.leadsByDay = m.leadsByDay30.slice(16);
  return { m, weekLeads, fakesAll, partnerTotal, partnerSeparated };
}

export async function fetchAccountMetrics(a: Account): Promise<AccountMetrics> {
  const empty = emptyMetrics(a.slug);
  if (!a.locationId || !a.pitEnv) return empty;
  const pit = process.env[a.pitEnv];
  if (!pit) return empty;

  try {
    const now = Date.now();
    const day = 86_400_000;
    const { contacts, total } = await withRetry(() => fetchContacts(a, pit, now));
    const { m } = scanContacts(a, contacts, total, now);

    try {
      const conv = (await withRetry(() => hlGet(`/conversations/search?locationId=${a.locationId}&limit=100`, pit), 2)) as {
        conversations?: HLConversation[];
      };
      // Regra do Lucas (2026-11-22): conversa não lida só conta se o
      // contato for lead VERIFICADO. Não verificado, fake, Partner (MF)
      // ou contato fora da janela coletada: some dos contadores.
      const verifiedIds = verifiedContactIds(a, contacts);
      const knownIds = new Set(contacts.map((c) => c.id));
      for (const cv of conv.conversations ?? []) {
        if ((cv.unreadCount ?? 0) > 0) {
          if (cv.contactId && verifiedIds.has(cv.contactId)) {
            m.unreadConversations++;
            m.unread += cv.unreadCount ?? 0;
            const last = cv.lastMessageDate ?? cv.createdAt ?? 0;
            if (last && now - last < 7 * day) m.unreadHot7d++;
          } else {
            m.unreadHidden++;
            if (!cv.contactId || !knownIds.has(cv.contactId)) m.unreadHiddenUnknown++;
          }
        }
      }
    } catch { /* conversas são bônus, não derrubam a conta */ }

    try {
      const opp = (await withRetry(() => hlGet(`/opportunities/search?location_id=${a.locationId}&limit=100`, pit), 2)) as {
        opportunities?: HLOpportunity[];
      };
      for (const o of opp.opportunities ?? []) {
        if ((o.status ?? "open") !== "open") continue;
        const value = o.monetaryValue ?? 0;
        m.opportunitiesOpen++;
        m.opportunitiesValue += value;
        const created = new Date(o.createdAt ?? 0).getTime();
        if (created && now - created < 7 * day) {
          m.oppNew7d++;
          m.oppNew7dValue += value;
        }
        const lastMove = new Date(o.lastStatusChangeAt ?? o.updatedAt ?? o.createdAt ?? 0).getTime();
        if (lastMove && now - lastMove >= 14 * day) {
          m.oppStaleCount++;
          m.oppStaleValue += value;
        }
      }
    } catch { /* idem */ }

    return m;
  } catch {
    return empty;
  }
}

// ------------------------------------------------------------ página da conta

export interface ConversationItem {
  contactName: string;
  unreadCount: number;
  lastActivity: string | null; // formatado em America/Chicago
  preview: string | null; // corpo da última mensagem, quando a API entrega
  channel: string | null; // SMS, Email, WhatsApp... quando dá para saber
}

export interface OpportunityItem {
  name: string;
  value: number;
  status: string;
  stage: string | null; // nome da etapa, via pipelines da location
  stale: boolean; // aberta sem movimento há 14+ dias
  created: string | null;
}

export interface AccountDetail {
  metrics: AccountMetrics;
  weekLeads: LeadItem[]; // lista completa dos leads limpos dos últimos 7 dias
  fakesAll: FakeItem[]; // quarentena da conta (30d, até 30)
  waiting: ConversationItem[]; // conversas sem resposta de leads VERIFICADOS (unreadCount > 0)
  waitingHidden: number; // conversas esperando escondidas: contato não verificado, fake, Partner ou fora da janela
  waitingHiddenUnknown: number; // dessas, quantas o contato nem está na janela coletada
  conversationsLoaded: number; // conversas lidas (limite da busca: 100)
  conversationsTotal: number | null; // total na location, quando a API informa
  upToDate: number; // conversas lidas sem nada pendente
  opportunities: OpportunityItem[]; // abertas, maior valor primeiro
  partnerTotal: number; // compradores Partner US$ 1 escondidos (só Magnetic Funnels US)
  partnerSeparated: number; // desses, já separados no HighLevel (tag partner-usd1)
}

function fmtChicago(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago",
  });
}

/** Canal legível a partir dos campos crus da conversa (quando a API os entrega). */
function channelLabel(cv: HLConversation): string | null {
  const raw = `${cv.lastMessageType ?? ""} ${cv.type ?? ""}`.toUpperCase();
  if (!raw.trim()) return null;
  if (raw.includes("WHATSAPP")) return "WhatsApp";
  if (raw.includes("INSTAGRAM") || raw.includes("IG")) return "Instagram";
  if (raw.includes("FACEBOOK") || raw.includes("FB") || raw.includes("MESSENGER")) return "Facebook";
  if (raw.includes("EMAIL")) return "Email";
  if (raw.includes("CALL")) return "Call";
  if (raw.includes("SMS") || raw.includes("PHONE")) return "SMS";
  if (raw.includes("CHAT")) return "Chat";
  if (raw.includes("GMB") || raw.includes("GOOGLE")) return "Google";
  return null;
}

/** Corpo da última mensagem como texto curto: tira HTML e corta em ~140 caracteres. */
function previewText(body?: string): string | null {
  if (!body) return null;
  const clean = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > 140 ? `${clean.slice(0, 140)}…` : clean;
}

/**
 * Detalhe completo de UMA conta para a página /account/<slug>: reaproveita a
 * mesma coleta da home (contatos paginados + scan) e acrescenta as listas que
 * a home não mostra: leads da semana inteiros, conversas sem resposta com
 * nome do contato e oportunidades abertas com etapa. Lança erro se a busca
 * de contatos falhar, para a página mostrar o estado "sem dados" em vez de
 * números zerados.
 */
export async function fetchAccountDetail(a: Account): Promise<AccountDetail> {
  if (!a.locationId || !a.pitEnv) throw new Error("Account has no HighLevel location");
  const pit = process.env[a.pitEnv];
  if (!pit) throw new Error("Account token is not configured");

  const now = Date.now();
  const day = 86_400_000;
  const { contacts, total } = await withRetry(() => fetchContacts(a, pit, now));
  const { m, weekLeads, fakesAll, partnerTotal, partnerSeparated } = scanContacts(a, contacts, total, now);

  let waiting: ConversationItem[] = [];
  let waitingHidden = 0;
  let waitingHiddenUnknown = 0;
  let conversationsLoaded = 0;
  let conversationsTotal: number | null = null;
  let upToDate = 0;
  try {
    const conv = (await withRetry(() => hlGet(`/conversations/search?locationId=${a.locationId}&limit=100`, pit), 2)) as {
      conversations?: HLConversation[];
      total?: number;
    };
    const list = conv.conversations ?? [];
    conversationsLoaded = list.length;
    conversationsTotal = typeof conv.total === "number" ? conv.total : null;
    // Regra do Lucas (2026-11-22): a lista de espera só mostra conversa
    // de lead VERIFICADO. Contato não verificado, fake, Partner (MF) ou
    // fora da janela coletada fica fora da lista e dos contadores.
    const verifiedIds = verifiedContactIds(a, contacts);
    const knownIds = new Set(contacts.map((c) => c.id));
    for (const cv of list) {
      const un = cv.unreadCount ?? 0;
      if (un > 0) {
        if (cv.contactId && verifiedIds.has(cv.contactId)) {
          m.unreadConversations++;
          m.unread += un;
          const last = cv.lastMessageDate ?? cv.createdAt ?? 0;
          if (last && now - last < 7 * day) m.unreadHot7d++;
          waiting.push({
            contactName: cv.contactName || "Unknown contact",
            unreadCount: un,
            lastActivity: last ? fmtChicago(last) : null,
            preview: previewText(cv.lastMessageBody),
            channel: channelLabel(cv),
          });
        } else {
          waitingHidden++;
          m.unreadHidden++;
          if (!cv.contactId || !knownIds.has(cv.contactId)) {
            waitingHiddenUnknown++;
            m.unreadHiddenUnknown++;
          }
        }
      } else {
        upToDate++;
      }
    }
    waiting = waiting.sort((x, y) => y.unreadCount - x.unreadCount);
  } catch { /* conversas são bônus, não derrubam a conta */ }

  let opportunities: OpportunityItem[] = [];
  try {
    const opp = (await withRetry(() => hlGet(`/opportunities/search?location_id=${a.locationId}&limit=100`, pit), 2)) as {
      opportunities?: HLOpportunity[];
    };
    const open = (opp.opportunities ?? []).filter((o) => (o.status ?? "open") === "open");

    // Nome das etapas, para mostrar onde cada oportunidade está.
    const stageName = new Map<string, string>();
    if (open.some((o) => o.pipelineStageId)) {
      try {
        const pl = (await hlGet(`/opportunities/pipelines?locationId=${a.locationId}`, pit)) as {
          pipelines?: Array<{ stages?: Array<{ id: string; name: string }> }>;
        };
        for (const p of pl.pipelines ?? []) {
          for (const s of p.stages ?? []) stageName.set(s.id, s.name);
        }
      } catch { /* sem pipelines, a lista sai sem o nome da etapa */ }
    }

    for (const o of open) {
      const value = o.monetaryValue ?? 0;
      m.opportunitiesOpen++;
      m.opportunitiesValue += value;
      const created = new Date(o.createdAt ?? 0).getTime();
      if (created && now - created < 7 * day) {
        m.oppNew7d++;
        m.oppNew7dValue += value;
      }
      const lastMove = new Date(o.lastStatusChangeAt ?? o.updatedAt ?? o.createdAt ?? 0).getTime();
      const stale = Boolean(lastMove && now - lastMove >= 14 * day);
      if (stale) {
        m.oppStaleCount++;
        m.oppStaleValue += value;
      }
      opportunities.push({
        name: o.name || "Untitled opportunity",
        value,
        status: o.status ?? "open",
        stage: o.pipelineStageId ? stageName.get(o.pipelineStageId) ?? null : null,
        stale,
        created: created ? fmtChicago(created) : null,
      });
    }
    opportunities.sort((x, y) => y.value - x.value);
  } catch { /* idem */ }

  return {
    metrics: m,
    weekLeads,
    fakesAll,
    waiting,
    waitingHidden,
    waitingHiddenUnknown,
    conversationsLoaded,
    conversationsTotal,
    upToDate,
    opportunities,
    partnerTotal,
    partnerSeparated,
  };
}

// ------------------------------------------------- apoio às rotas de ação
// As rotas /api/delete-unverified e /api/partner-separate usam estas
// funções para classificar contatos FRESCOS (sem o cache de 5 minutos)
// com exatamente as mesmas regras das listas do painel.

export interface ContactRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  addedAt: string | null; // ISO
}

/** Registro de um contato para o log de exclusão/separação. */
export function contactRecord(c: HLContact): ContactRecord {
  return {
    id: c.id,
    name: contactName(c),
    email: c.email ?? null,
    phone: c.phone ?? null,
    source: c.source ?? null,
    addedAt: c.dateAdded ?? null,
  };
}

/** Contatos da location lidos agora, sem cache. Lança erro se a busca falhar. */
export async function fetchContactsLive(a: Account): Promise<HLContact[]> {
  if (!a.locationId || !a.pitEnv) throw new Error("Account has no HighLevel location");
  const pit = process.env[a.pitEnv];
  if (!pit) throw new Error("Account token is not configured");
  const { contacts } = await fetchContacts(a, pit, Date.now(), true);
  return contacts;
}

/**
 * Não verificados dos últimos 7 dias: a MESMA classificação da lista da
 * página da conta (não é fake, origem é email avulso). É este conjunto, e
 * só ele, que a exclusão em massa pode tocar.
 *
 * EXCLUSÃO DURA (regra do Lucas, 2026-11-22): contato com "Partner Plan"
 * no source NUNCA é excluível, em qualquer conta, sem exceção. Quem passou
 * pelo plano Partner continua no sistema; ele só fica fora da
 * visualização da Magnetic Funnels. Esta trava é explícita e não depende
 * de como o resto da classificação evoluir: mesmo que um source do tipo
 * "Partner Plan - Email ..." um dia caia em isEmailOnly, ele sai daqui.
 */
export function unverifiedWeekContacts(contacts: HLContact[], now: number): HLContact[] {
  const day = 86_400_000;
  return contacts.filter((c) => {
    const t = new Date(c.dateAdded ?? 0).getTime();
    if (!t || now - t >= 7 * day) return false;
    if (isPartnerPlanContact(c)) return false; // trava dura: Partner nunca é excluível
    if (hasLeadVerifiedTag(c)) return false; // verificado à mão nunca é excluível
    return !isFake(c) && isEmailOnly(c);
  });
}

/** Compradores Partner US$ 1 da conta (marcador: source do Partner Plan). */
export function partnerBuyerContacts(a: Account, contacts: HLContact[]): HLContact[] {
  return contacts.filter((c) => isPartnerBuyer(a, c));
}

// ------------------------------------------------- verificação completa
// Botão "Verify leads" (pedido do Lucas, 2026-11-22): sob demanda, pagina
// por TODOS os contatos da location, sem o teto de 500 da coleta normal e
// sem cache, e classifica cada um com a regra única do painel. Só leitura:
// não exclui nem altera nada no HighLevel.

export interface VerifyResult {
  slug: string;
  account: string;
  total: number; // total de contatos na location, segundo a API
  scanned: number; // contatos efetivamente lidos e classificados
  verified: number;
  unverified: number;
  fakes: number;
  partner: number; // compradores Partner US$ 1 (só Magnetic Funnels US)
  checkedAt: string; // ISO
}

/** Lê TODAS as páginas de contatos da location (lotes paralelos de 5). */
async function fetchAllContacts(a: Account, pit: string): Promise<{ contacts: HLContact[]; total: number }> {
  const contacts: HLContact[] = [];
  let total = 0;
  const BATCH = 5;
  const MAX_PAGE = 400; // trava de segurança: 40 mil contatos
  for (let start = 1; start <= MAX_PAGE; start += BATCH) {
    const pages = Array.from({ length: BATCH }, (_, i) => start + i).filter((p) => p <= MAX_PAGE);
    const results = await Promise.all(
      pages.map(async (page) => {
        return (await withRetry(
          () => hlFetch(`/contacts/?locationId=${a.locationId}&limit=100&page=${page}`, pit, true),
          2,
        )) as {
          contacts?: HLContact[];
          meta?: { total?: number; nextPage?: number | null };
        };
      }),
    );
    let stop = false;
    for (const data of results) {
      const batch = data.contacts ?? [];
      contacts.push(...batch);
      if (typeof data.meta?.total === "number") total = data.meta.total;
      if (!data.meta?.nextPage || batch.length === 0) stop = true;
    }
    if (stop) break;
  }
  return { contacts, total: total || contacts.length };
}

export async function verifyAccountLeads(a: Account): Promise<VerifyResult> {
  if (!a.locationId || !a.pitEnv) throw new Error("Account has no HighLevel location");
  const pit = process.env[a.pitEnv];
  if (!pit) throw new Error("Account token is not configured");

  const { contacts, total } = await fetchAllContacts(a, pit);
  const result: VerifyResult = {
    slug: a.slug,
    account: a.name,
    total,
    scanned: contacts.length,
    verified: 0,
    unverified: 0,
    fakes: 0,
    partner: 0,
    checkedAt: new Date().toISOString(),
  };
  for (const c of contacts) {
    const cls = classifyContact(a, c);
    if (cls === "verified") result.verified++;
    else if (cls === "unverified") result.unverified++;
    else if (cls === "fake") result.fakes++;
    else result.partner++;
  }
  return result;
}
