// Modelo de exibição da AGENDA (unificação, 2026-11-22): mistura
// os eventos reais do snapshot (lib/command.ts) com os RITUAIS
// semanais e o BLOCO PROTEGIDO diário, que são regras fixas do Lucas
// e não eventos gravados:
//   - Bloco de criação de conteúdo: todo dia, 09:00-10:00 (config
//     conferida na central Criação de Conteúdo: ligado, 60 min)
//   - Office Hours: terça e quinta, 10:00-11:00
//   - Academy: quarta, 16:00 (compromissos de quarta terminam às
//     15:00 por causa dela; evento real de quarta que passa das
//     15:00 ganha o aviso lateWed)
//   - Coworking: sexta, 08:00-10:00
// Quando existe evento real correspondente no mesmo dia e horário
// (a Academy no Outlook, por exemplo), o evento real substitui o
// ritual gerado: nada aparece duplicado. Tudo em America/Chicago.

import type { AgendaEvent, AgendaSnapshot } from "./command";
import { TZ } from "@/components/viz";

export interface AgendaItem {
  key: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  allDay: boolean;
  kind: "event" | "ritual" | "content";
  source?: AgendaEvent["source"];
  calendar?: string;
  location?: string;
  /** Evento real de quarta que passa das 15:00 (a Academy é às 16:00). */
  lateWed?: boolean;
}

export interface AgendaDay {
  date: string; // YYYY-MM-DD em Chicago
  items: AgendaItem[];
}

const DAY_MS = 86_400_000;

/** Data de Chicago (YYYY-MM-DD) de um instante. */
export function chicagoDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY_MS);
  return t.toISOString().slice(0, 10);
}

/** Dia da semana (0=domingo) de uma data YYYY-MM-DD. */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Deslocamento do fuso no instante dado (ms a somar ao UTC para obter o relógio local). */
function tzOffsetMs(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const p: Record<string, number> = {};
  for (const part of parts) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Instante UTC de um horário de parede de Chicago ("2026-11-25", "16:00"). */
export function chicagoInstant(dateStr: string, hhmm: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = tzOffsetMs(new Date(guess));
  return new Date(guess - off);
}

/** "10:00 AM" em Chicago. */
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

/** Hora de parede de Chicago em minutos desde a meia-noite. */
function chicagoMinutes(iso: string): number {
  const s = new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
  const [h, m] = s.split(":").map(Number);
  return (h % 24) * 60 + m;
}

interface RitualDef {
  kind: "ritual" | "content";
  title: string;
  start: string; // "HH:MM" Chicago
  end: string;
  days: number[] | "daily";
  keywords: string[];
}

const RITUALS: RitualDef[] = [
  { kind: "content", title: "Content creation · protected block", start: "09:00", end: "10:00", days: "daily", keywords: ["content creation", "criação de conteúdo", "criacao de conteudo"] },
  { kind: "ritual", title: "Office Hours", start: "10:00", end: "11:00", days: [2, 4], keywords: ["office hours"] },
  { kind: "ritual", title: "Magnetic Flows Academy", start: "16:00", end: "17:00", days: [3], keywords: ["academy"] },
  { kind: "ritual", title: "Coworking", start: "08:00", end: "10:00", days: [5], keywords: ["coworking", "co-working", "co working"] },
];

function ritualsFor(dateStr: string, real: AgendaEvent[]): AgendaItem[] {
  const wd = weekdayOf(dateStr);
  const out: AgendaItem[] = [];
  for (const r of RITUALS) {
    if (r.days !== "daily" && !r.days.includes(wd)) continue;
    const start = chicagoInstant(dateStr, r.start);
    const end = chicagoInstant(dateStr, r.end);
    // Evento real correspondente (mesmo começo, título com a palavra do ritual) substitui o gerado.
    const replaced = real.some((e) => {
      if (e.allDay) return false;
      const t = e.title.toLowerCase();
      return Math.abs(new Date(e.start).getTime() - start.getTime()) < 30 * 60_000
        && r.keywords.some((k) => t.includes(k));
    });
    if (replaced) continue;
    out.push({
      key: `ritual-${dateStr}-${r.start}-${r.title}`,
      title: r.title,
      start: start.toISOString(),
      end: end.toISOString(),
      allDay: false,
      kind: r.kind,
    });
  }
  return out;
}

/** Um dia montado: eventos reais do snapshot + rituais não substituídos, em ordem. */
export function buildDay(snapshot: AgendaSnapshot | undefined, dateStr: string): AgendaDay {
  const real = (snapshot?.events ?? []).filter((e) => chicagoDateStr(new Date(e.start)) === dateStr);
  const items: AgendaItem[] = real.map((e) => ({
    key: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    kind: "event" as const,
    source: e.source,
    calendar: e.calendar,
    location: e.location,
    lateWed: weekdayOf(dateStr) === 3 && !e.allDay
      && chicagoMinutes(e.end) > 15 * 60
      && !e.title.toLowerCase().includes("academy"),
  }));
  items.push(...ritualsFor(dateStr, real));
  items.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return { date: dateStr, items };
}

export function buildDays(snapshot: AgendaSnapshot | undefined, fromDateStr: string, days: number): AgendaDay[] {
  return Array.from({ length: days }, (_, i) => buildDay(snapshot, addDays(fromDateStr, i)));
}

/** Próximo item (real ou ritual) que ainda não terminou, olhando 14 dias à frente. */
export function nextItem(snapshot: AgendaSnapshot | undefined, now = new Date()): AgendaItem | null {
  const today = chicagoDateStr(now);
  for (let i = 0; i < 14; i++) {
    const day = buildDay(snapshot, addDays(today, i));
    for (const item of day.items) {
      if (!item.allDay && new Date(item.end).getTime() > now.getTime()) return item;
    }
  }
  return null;
}

/** Minutos livres hoje entre 07:00 e 19:00 de Chicago, descontando os itens com horário. */
export function freeMinutesToday(snapshot: AgendaSnapshot | undefined, now = new Date()): number {
  const today = chicagoDateStr(now);
  const day = buildDay(snapshot, today);
  const winStart = chicagoInstant(today, "07:00").getTime();
  const winEnd = chicagoInstant(today, "19:00").getTime();
  const spans = day.items
    .filter((i) => !i.allDay)
    .map((i) => [Math.max(winStart, new Date(i.start).getTime()), Math.min(winEnd, new Date(i.end).getTime())] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let busy = 0;
  let curS = -1;
  let curE = -1;
  for (const [s, e] of spans) {
    if (s > curE) {
      if (curE > curS) busy += curE - curS;
      curS = s; curE = e;
    } else if (e > curE) curE = e;
  }
  if (curE > curS) busy += curE - curS;
  return Math.max(0, Math.round((winEnd - winStart - busy) / 60_000));
}

/** Rótulo curto da fonte para o chip da tela. */
export const SOURCE_LABEL: Record<AgendaEvent["source"], string> = {
  outlook: "Outlook",
  google: "Google",
  highlevel: "HighLevel",
};
