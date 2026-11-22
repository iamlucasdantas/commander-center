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
  name: string;
  when: string;
  sourceLabel: string;
  emailOnly: boolean;
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
  opportunitiesOpen: number;
  opportunitiesValue: number;
  oppStaleCount: number; // abertas sem movimento há 14+ dias
  oppStaleValue: number;
  oppNew7d: number; // abertas criadas nos últimos 7 dias
  oppNew7dValue: number;
  recentLeads: LeadItem[];
  fakes: FakeItem[];
  fakeCount30d: number; // total de fakes em 30d (a lista é limitada a 10)
  sourceCounts: Record<string, number>; // composição de fontes dos leads limpos, 30d
  leadsByDay: number[]; // 14 dias, do mais antigo ao mais novo
  leadsByDay30: number[]; // últimos 30 dias, do mais antigo ao mais novo
  leadsByDayPrev30: number[]; // 30 dias anteriores, do mais antigo ao mais novo
}

interface HLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  contactName?: string;
  name?: string;
  email?: string;
  source?: string;
  dateAdded?: string;
  type?: string;
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

async function hlGet(path: string, pit: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${pit}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`HL ${res.status}`);
  return res.json();
}

function emptyMetrics(slug: string): AccountMetrics {
  return {
    slug, ok: false, fetchedAt: 0, leadsToday: 0, leadsYesterday: 0,
    leads7d: 0, leadsPrev7d: 0, leads30d: 0, leadsPrev30d: 0,
    totalContacts: 0, unread: 0, unreadConversations: 0, unreadHot7d: 0,
    opportunitiesOpen: 0, opportunitiesValue: 0,
    oppStaleCount: 0, oppStaleValue: 0, oppNew7d: 0, oppNew7dValue: 0,
    recentLeads: [], fakes: [], fakeCount30d: 0, sourceCounts: {},
    leadsByDay: Array(14).fill(0),
    leadsByDay30: Array(30).fill(0),
    leadsByDayPrev30: Array(30).fill(0),
  };
}

/** Busca os contatos recentes da location (até 5 páginas, janela de 60 dias). */
async function fetchContacts(a: Account, pit: string, now: number): Promise<{ contacts: HLContact[]; total: number }> {
  const day = 86_400_000;
  const contacts: HLContact[] = [];
  let total = 0;
  // Até 5 páginas (500 contatos mais recentes) para fechar a janela de
  // 60 dias nas contas grandes. Para cedo se uma página inteira já está
  // fora da janela (a lista vem da mais recente para a mais antiga).
  for (let page = 1; page <= 5; page++) {
    const data = (await hlGet(`/contacts/?locationId=${a.locationId}&limit=100&page=${page}`, pit)) as {
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
  for (const c of contacts) {
    const t = new Date(c.dateAdded ?? 0).getTime();
    if (!t) continue;
    const age = now - t;
    const ageDays = Math.floor(age / day);
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
      const item: LeadItem = {
        name: contactName(c),
        when: new Date(t).toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago" }),
        sourceLabel: c.source || (isEmailOnly(c) ? "stray email" : "no source"),
        emailOnly: isEmailOnly(c),
      };
      weekLeads.push(item);
      if (m.recentLeads.length < 8) m.recentLeads.push(item);
    }
  }
  m.leadsByDay = m.leadsByDay30.slice(16);
  return { m, weekLeads, fakesAll };
}

export async function fetchAccountMetrics(a: Account): Promise<AccountMetrics> {
  const empty = emptyMetrics(a.slug);
  if (!a.locationId || !a.pitEnv) return empty;
  const pit = process.env[a.pitEnv];
  if (!pit) return empty;

  try {
    const now = Date.now();
    const day = 86_400_000;
    const { contacts, total } = await fetchContacts(a, pit, now);
    const { m } = scanContacts(a, contacts, total, now);

    try {
      const conv = (await hlGet(`/conversations/search?locationId=${a.locationId}&limit=100`, pit)) as {
        conversations?: HLConversation[];
      };
      for (const cv of conv.conversations ?? []) {
        if ((cv.unreadCount ?? 0) > 0) {
          m.unreadConversations++;
          m.unread += cv.unreadCount ?? 0;
          const last = cv.lastMessageDate ?? cv.createdAt ?? 0;
          if (last && now - last < 7 * day) m.unreadHot7d++;
        }
      }
    } catch { /* conversas são bônus, não derrubam a conta */ }

    try {
      const opp = (await hlGet(`/opportunities/search?location_id=${a.locationId}&limit=100`, pit)) as {
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
  waiting: ConversationItem[]; // conversas sem resposta (unreadCount > 0)
  conversationsLoaded: number; // conversas lidas (limite da busca: 100)
  conversationsTotal: number | null; // total na location, quando a API informa
  upToDate: number; // conversas lidas sem nada pendente
  opportunities: OpportunityItem[]; // abertas, maior valor primeiro
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
  const { contacts, total } = await fetchContacts(a, pit, now);
  const { m, weekLeads, fakesAll } = scanContacts(a, contacts, total, now);

  let waiting: ConversationItem[] = [];
  let conversationsLoaded = 0;
  let conversationsTotal: number | null = null;
  let upToDate = 0;
  try {
    const conv = (await hlGet(`/conversations/search?locationId=${a.locationId}&limit=100`, pit)) as {
      conversations?: HLConversation[];
      total?: number;
    };
    const list = conv.conversations ?? [];
    conversationsLoaded = list.length;
    conversationsTotal = typeof conv.total === "number" ? conv.total : null;
    for (const cv of list) {
      const un = cv.unreadCount ?? 0;
      if (un > 0) {
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
        upToDate++;
      }
    }
    waiting = waiting.sort((x, y) => y.unreadCount - x.unreadCount);
  } catch { /* conversas são bônus, não derrubam a conta */ }

  let opportunities: OpportunityItem[] = [];
  try {
    const opp = (await hlGet(`/opportunities/search?location_id=${a.locationId}&limit=100`, pit)) as {
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
    conversationsLoaded,
    conversationsTotal,
    upToDate,
    opportunities,
  };
}
