// Coleta ao vivo do HighLevel (API v2) usando o PIT de cada location.
// Nada é gravado aqui: a leitura acontece na abertura do painel, com cache
// de 5 minutos, e some na tela. Histórico e snapshots entram na fase do
// banco próprio do Commander Center.
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
  leadsToday: number;
  leads7d: number;
  leadsPrev7d: number;
  leads30d: number;
  totalContacts: number;
  unread: number;
  unreadConversations: number;
  opportunitiesOpen: number;
  opportunitiesValue: number;
  recentLeads: LeadItem[];
  fakes: FakeItem[];
  leadsByDay: number[]; // 14 dias, do mais antigo ao mais novo
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
    slug: a.slug, ok: false, leadsToday: 0, leads7d: 0, leadsPrev7d: 0, leads30d: 0,
    totalContacts: 0, unread: 0, unreadConversations: 0, opportunitiesOpen: 0,
    opportunitiesValue: 0, recentLeads: [], fakes: [], leadsByDay: Array(14).fill(0),
  };
  if (!a.locationId || !a.pitEnv) return empty;
  const pit = process.env[a.pitEnv];
  if (!pit) return empty;

  try {
    const now = Date.now();
    const day = 86_400_000;
    const contacts: HLContact[] = [];
    let total = 0;
    for (let page = 1; page <= 3; page++) {
      const data = (await hlGet(`/contacts/?locationId=${a.locationId}&limit=100&page=${page}`, pit)) as {
        contacts?: HLContact[];
        meta?: { total?: number; nextPage?: number | null };
      };
      const batch = data.contacts ?? [];
      contacts.push(...batch);
      total = data.meta?.total ?? contacts.length;
      if (!data.meta?.nextPage || batch.length === 0) break;
    }
    contacts.sort((x, y) => new Date(y.dateAdded ?? 0).getTime() - new Date(x.dateAdded ?? 0).getTime());

    const m: AccountMetrics = { ...empty, ok: true, totalContacts: total, leadsByDay: Array(14).fill(0) };
    for (const c of contacts) {
      const t = new Date(c.dateAdded ?? 0).getTime();
      if (!t) continue;
      const age = now - t;
      const fake = isFake(c);
      if (fake) {
        if (age < 30 * day && m.fakes.length < 10) {
          m.fakes.push({ name: contactName(c), account: a.name, reason: "company/service name, stray email" });
        }
        continue;
      }
      if (age < day) m.leadsToday++;
      if (age < 7 * day) m.leads7d++;
      if (age >= 7 * day && age < 14 * day) m.leadsPrev7d++;
      if (age < 30 * day) m.leads30d++;
      const dayIdx = 13 - Math.floor(age / day);
      if (dayIdx >= 0 && dayIdx < 14) m.leadsByDay[dayIdx]++;
      if (m.recentLeads.length < 8 && age < 7 * day) {
        m.recentLeads.push({
          name: contactName(c),
          when: new Date(t).toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
          sourceLabel: c.source || (isEmailOnly(c) ? "stray email" : "no source"),
          emailOnly: isEmailOnly(c),
        });
      }
    }

    try {
      const conv = (await hlGet(`/conversations/search?locationId=${a.locationId}&limit=100`, pit)) as {
        conversations?: Array<{ unreadCount?: number }>;
      };
      for (const cv of conv.conversations ?? []) {
        if ((cv.unreadCount ?? 0) > 0) {
          m.unreadConversations++;
          m.unread += cv.unreadCount ?? 0;
        }
      }
    } catch { /* conversas são bônus, não derrubam a conta */ }

    try {
      const opp = (await hlGet(`/opportunities/search?location_id=${a.locationId}&limit=100`, pit)) as {
        opportunities?: Array<{ status?: string; monetaryValue?: number }>;
      };
      for (const o of opp.opportunities ?? []) {
        if ((o.status ?? "open") === "open") {
          m.opportunitiesOpen++;
          m.opportunitiesValue += o.monetaryValue ?? 0;
        }
      }
    } catch { /* idem */ }

    return m;
  } catch {
    return empty;
  }
}
