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
}

interface HLOpportunity {
  status?: string;
  monetaryValue?: number;
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

export async function fetchAccountMetrics(a: Account): Promise<AccountMetrics> {
  const empty: AccountMetrics = {
    slug: a.slug, ok: false, fetchedAt: 0, leadsToday: 0, leadsYesterday: 0,
    leads7d: 0, leadsPrev7d: 0, leads30d: 0, leadsPrev30d: 0,
    totalContacts: 0, unread: 0, unreadConversations: 0, unreadHot7d: 0,
    opportunitiesOpen: 0, opportunitiesValue: 0,
    oppStaleCount: 0, oppStaleValue: 0, oppNew7d: 0, oppNew7dValue: 0,
    recentLeads: [], fakes: [], fakeCount30d: 0, sourceCounts: {},
    leadsByDay: Array(14).fill(0),
    leadsByDay30: Array(30).fill(0),
    leadsByDayPrev30: Array(30).fill(0),
  };
  if (!a.locationId || !a.pitEnv) return empty;
  const pit = process.env[a.pitEnv];
  if (!pit) return empty;

  try {
    const now = Date.now();
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

    const m: AccountMetrics = {
      ...empty, ok: true, fetchedAt: now, totalContacts: total,
      leadsByDay: Array(14).fill(0), leadsByDay30: Array(30).fill(0), leadsByDayPrev30: Array(30).fill(0),
    };
    for (const c of contacts) {
      const t = new Date(c.dateAdded ?? 0).getTime();
      if (!t) continue;
      const age = now - t;
      const ageDays = Math.floor(age / day);
      const fake = isFake(c);
      if (fake) {
        if (age < 30 * day) {
          m.fakeCount30d++;
          if (m.fakes.length < 10) {
            m.fakes.push({ name: contactName(c), account: a.name, reason: "company/service name, stray email" });
          }
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
      if (m.recentLeads.length < 8 && age < 7 * day) {
        m.recentLeads.push({
          name: contactName(c),
          when: new Date(t).toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Chicago" }),
          sourceLabel: c.source || (isEmailOnly(c) ? "stray email" : "no source"),
          emailOnly: isEmailOnly(c),
        });
      }
    }
    m.leadsByDay = m.leadsByDay30.slice(16);

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
