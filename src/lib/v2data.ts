// Camada de dados do Commander Center 2.0 (rota /v2, spec do Lucas
// de 2026-11-24). Arquivo NOVO: nada aqui altera a coleta nem o
// comportamento da versão atual. As leituras usam os MESMOS endpoints
// e o MESMO cache de 5 minutos da coleta atual (as URLs são idênticas,
// então o cache HTTP é compartilhado), e a classificação de contatos
// reaproveita as funções puras já exportadas por hl.ts
// (classifyWithMarks, isGoneContact, loadMarks): as regras do painel
// são as mesmas, o que muda é a AGREGAÇÃO.
//
// Diferenças de agregação do v2 (spec, seções 5 e 6):
//   - KPIs de topo contam só contatos VERIFICADOS (stray email e
//     importações ficam fora; os números "all clean" são guardados à
//     parte só para a regra de pico suspeito);
//   - "Waiting for reply" segue a definição da spec: a última
//     mensagem é do cliente (lastMessageDirection = inbound), com
//     fallback para unreadCount > 0 quando a direção não vem no
//     payload; só de leads verificados, como manda a regra de
//     2026-11-22, e com a IDADE da espera (lastMessageDate);
//   - receita ganha (won) por mudança de status nos últimos 30 dias.
import { hasToken, type Account } from "./accounts";
import {
  classifyWithMarks, isGoneContact, loadMarks,
  type ContactMarks, type HLContact,
} from "./hl";

const BASE = "https://services.leadconnectorhq.com";
const DAY = 86_400_000;
export const TZ2 = "America/Chicago";

export interface WaitingItem {
  contactId: string | null;
  contactName: string;
  ageMin: number; // minutos desde a última mensagem do cliente
  ts: number; // epoch ms da última atividade
  unread: number;
  channel: string | null;
  preview: string | null;
}

export interface V2AccountData {
  slug: string;
  ok: boolean;
  fetchedAt: number;
  totalContacts: number;
  // Contatos VERIFICADOS por período (KPI de topo do v2)
  contactsTodayV: number;
  contactsYesterdayV: number;
  contacts7dV: number;
  contactsPrev7dV: number;
  contacts30dV: number;
  contactsPrev30dV: number;
  // Todos os contatos limpos (sem fake/partner/gone), só para a regra de pico
  contacts7dAll: number;
  contactsPrev7dAll: number;
  leadsByDay30V: number[]; // verificados, 30 dias, do mais antigo ao mais novo
  leadsByDayPrev30V: number[]; // verificados, 30 dias anteriores
  historyContacts: number; // contatos limpos com 28+ dias (base p/ "no baseline")
  fakeCount30d: number;
  waiting: WaitingItem[]; // ordenado por idade, maior primeiro
  waitingCount: number;
  waitingOldestMin: number | null;
  respondedCount: number; // conversas (leads verificados) cuja última mensagem é da empresa
  conversationsWindow: number; // conversas lidas na janela (limite da busca: 100)
  unreadConversations: number; // estilo v1 (unreadCount > 0, verificados), referência
  opportunitiesOpen: number;
  opportunitiesValue: number;
  idleCount: number; // abertas sem movimento há 14+ dias
  idleValue: number;
  won30Count: number;
  won30Value: number;
  topOpportunities: { id: string; name: string; stage: string | null; value: number; idle: boolean }[];
  searchContacts: { name: string; phone: string | null }[];
}

interface HLConversation {
  id?: string;
  unreadCount?: number;
  lastMessageDate?: number;
  createdAt?: number;
  contactName?: string;
  contactId?: string;
  lastMessageBody?: string;
  lastMessageType?: string;
  lastMessageDirection?: string;
  type?: string;
  messageTypes?: string[];
}

interface HLOpportunity {
  id?: string;
  name?: string;
  status?: string;
  monetaryValue?: number;
  pipelineStageId?: string;
  createdAt?: string;
  updatedAt?: string;
  lastStatusChangeAt?: string;
}

async function hlGet(path: string, pit: string): Promise<unknown> {
  const init: RequestInit & { next?: { revalidate: number } } = {
    headers: {
      Authorization: `Bearer ${pit}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(9000),
    next: { revalidate: 300 },
  };
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`HL ${res.status}`);
  return res.json();
}

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

function contactName(c: HLContact): string {
  return (
    c.contactName ||
    c.name ||
    [c.firstName, c.lastName].filter(Boolean).join(" ") ||
    c.email ||
    "No name"
  );
}

function chicagoDayStr(ts: number): string {
  return new Date(ts).toLocaleDateString("en-CA", { timeZone: TZ2 });
}

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

function previewText(body?: string): string | null {
  if (!body) return null;
  const clean = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > 140 ? `${clean.slice(0, 140)}…` : clean;
}

/** Mesma janela da coleta atual: até 5 páginas (500), 60 dias. */
async function fetchContacts(a: Account, pit: string, now: number): Promise<{ contacts: HLContact[]; total: number }> {
  const contacts: HLContact[] = [];
  let total = 0;
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
    if (batchTimes.length && Math.max(...batchTimes) < now - 60 * DAY) break;
  }
  contacts.sort((x, y) => new Date(y.dateAdded ?? 0).getTime() - new Date(x.dateAdded ?? 0).getTime());
  return { contacts, total };
}

function emptyData(slug: string): V2AccountData {
  return {
    slug, ok: false, fetchedAt: 0, totalContacts: 0,
    contactsTodayV: 0, contactsYesterdayV: 0, contacts7dV: 0, contactsPrev7dV: 0,
    contacts30dV: 0, contactsPrev30dV: 0, contacts7dAll: 0, contactsPrev7dAll: 0,
    leadsByDay30V: Array(30).fill(0), leadsByDayPrev30V: Array(30).fill(0),
    historyContacts: 0, fakeCount30d: 0,
    waiting: [], waitingCount: 0, waitingOldestMin: null, respondedCount: 0, conversationsWindow: 0, unreadConversations: 0,
    opportunitiesOpen: 0, opportunitiesValue: 0, idleCount: 0, idleValue: 0,
    won30Count: 0, won30Value: 0, topOpportunities: [], searchContacts: [],
  };
}

export async function fetchV2Account(a: Account): Promise<V2AccountData> {
  const d = emptyData(a.slug);
  if (!a.locationId || !a.pitEnv) return d;
  const pit = process.env[a.pitEnv];
  if (!pit) return d;

  try {
    const now = Date.now();
    const { contacts, total } = await withRetry(() => fetchContacts(a, pit, now));
    const marks: ContactMarks = await loadMarks(a);
    d.ok = true;
    d.fetchedAt = now;

    const todayStr = chicagoDayStr(now);
    const yesterdayStr = chicagoDayStr(now - DAY);
    const verifiedIds = new Set<string>();
    const goneIds = new Set<string>();
    let goneCount = 0;

    for (const c of contacts) {
      const t = new Date(c.dateAdded ?? 0).getTime();
      if (!t) continue;
      if (isGoneContact(a, c, marks, now)) { goneIds.add(c.id); goneCount++; continue; }
      const cls = classifyWithMarks(a, c, marks);
      if (cls === "partner") continue;
      if (cls === "fake") {
        if (now - t < 30 * DAY) d.fakeCount30d++;
        continue;
      }
      // Limpo (verificado ou não verificado recente): entra no "all"
      // e no histórico; só o verificado entra nos KPIs de topo.
      const age = now - t;
      const ageDays = Math.floor(age / DAY);
      if (age >= 28 * DAY) d.historyContacts++;
      if (age < 7 * DAY) d.contacts7dAll++;
      if (age >= 7 * DAY && age < 14 * DAY) d.contactsPrev7dAll++;
      if (cls !== "verified") continue;
      verifiedIds.add(c.id);
      const dayStr = chicagoDayStr(t);
      if (dayStr === todayStr) d.contactsTodayV++;
      if (dayStr === yesterdayStr) d.contactsYesterdayV++;
      if (age < 7 * DAY) d.contacts7dV++;
      if (age >= 7 * DAY && age < 14 * DAY) d.contactsPrev7dV++;
      if (age < 30 * DAY) d.contacts30dV++;
      if (age >= 30 * DAY && age < 60 * DAY) d.contactsPrev30dV++;
      if (ageDays >= 0 && ageDays < 30) d.leadsByDay30V[29 - ageDays]++;
      if (ageDays >= 30 && ageDays < 60) d.leadsByDayPrev30V[59 - ageDays]++;
      if (d.searchContacts.length < 10) {
        d.searchContacts.push({ name: contactName(c), phone: c.phone ?? null });
      }
    }
    d.totalContacts = Math.max(0, total - goneCount);

    // Conversas: waiting for reply (definição da spec) + idade.
    try {
      const conv = (await withRetry(() => hlGet(`/conversations/search?locationId=${a.locationId}&limit=100`, pit), 2)) as {
        conversations?: HLConversation[];
      };
      d.conversationsWindow = (conv.conversations ?? []).length;
      for (const cv of conv.conversations ?? []) {
        if (!cv.contactId || goneIds.has(cv.contactId)) continue;
        if (!verifiedIds.has(cv.contactId)) continue;
        // Etapa "Responded" do funil (etapa 4): a última mensagem é da
        // empresa, ou seja, ela respondeu por último naquela conversa.
        if (cv.lastMessageDirection === "outbound") d.respondedCount++;
        const unread = cv.unreadCount ?? 0;
        if (unread > 0) d.unreadConversations++;
        const dir = cv.lastMessageDirection;
        const isWaiting = dir ? dir === "inbound" : unread > 0;
        if (!isWaiting) continue;
        const last = cv.lastMessageDate ?? cv.createdAt ?? 0;
        if (!last) continue;
        d.waiting.push({
          contactId: cv.contactId,
          contactName: cv.contactName || "Unknown contact",
          ageMin: Math.max(0, Math.round((now - last) / 60_000)),
          ts: last,
          unread,
          channel: channelLabel(cv),
          preview: previewText(cv.lastMessageBody),
        });
      }
      d.waiting.sort((x, y) => y.ageMin - x.ageMin);
      d.waitingCount = d.waiting.length;
      d.waitingOldestMin = d.waiting.length ? d.waiting[0].ageMin : null;
    } catch { /* conversas são bônus, não derrubam a conta */ }

    // Oportunidades: abertas, paradas 14d+ e ganhas em 30d.
    try {
      const opp = (await withRetry(() => hlGet(`/opportunities/search?location_id=${a.locationId}&limit=100`, pit), 2)) as {
        opportunities?: HLOpportunity[];
      };
      for (const o of opp.opportunities ?? []) {
        const st = o.status ?? "open";
        const value = o.monetaryValue ?? 0;
        if (st === "open") {
          d.opportunitiesOpen++;
          d.opportunitiesValue += value;
          const lastMove = new Date(o.lastStatusChangeAt ?? o.updatedAt ?? o.createdAt ?? 0).getTime();
          const isIdle = Boolean(lastMove && now - lastMove >= 14 * DAY);
          if (isIdle) {
            d.idleCount++;
            d.idleValue += value;
          }
          d.topOpportunities.push({
            id: o.id ?? `${o.name ?? "opp"}-${d.topOpportunities.length}`,
            name: o.name ?? "Opportunity",
            stage: null, // nomes de etapa exigem a busca de pipelines; fica para a etapa 4
            value,
            idle: isIdle,
          });
        } else if (st === "won") {
          const changed = new Date(o.lastStatusChangeAt ?? o.updatedAt ?? 0).getTime();
          if (changed && now - changed < 30 * DAY) {
            d.won30Count++;
            d.won30Value += value;
          }
        }
      }
      d.topOpportunities.sort((x, y) => y.value - x.value);
      d.topOpportunities = d.topOpportunities.slice(0, 10);
    } catch { /* idem */ }

    return d;
  } catch {
    return emptyData(a.slug);
  }
}

/** Todas as contas conectáveis com token; devolve só as que coletaram. */
export async function fetchAllV2(accounts: Account[]): Promise<V2AccountData[]> {
  const targets = accounts.filter((a) => a.sourceStatus === "hl-location" && hasToken(a));
  const out = await Promise.all(targets.map((a) => fetchV2Account(a)));
  return out.filter((d) => d.ok);
}

/** "3h 20m", "2d 5h", "45m": idade legível da espera. */
export function fmtAge(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m`;
  const days = Math.floor(h / 24);
  return `${days}d ${h % 24}h`;
}

/** Links profundos para o HighLevel (mesma location, tela certa). */
export function hlLink(locationId: string | null, area: "dashboard" | "conversations" | "opportunities"): string {
  if (!locationId) return "https://app.gohighlevel.com";
  return `https://app.gohighlevel.com/v2/location/${locationId}/${area}`;
}
