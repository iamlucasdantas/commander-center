// Camada de decisão do Commander Center 2.0 (spec 2026-11-24,
// seções 4, 5 e 6). Funções puras sobre os dados de v2data.ts:
//   - a NOVA regra de saúde (Act now / Watch / Flowing / No baseline,
//     sempre com o motivo em texto ao lado da cor);
//   - a regra de pico suspeito (seção 6.2);
//   - a Action queue ordenada por dinheiro em risco, com chaves
//     estáveis para Snooze/Done;
//   - o resumo "This week in 3 lines", gerado por regra, sem IA;
//   - a frase de diagnóstico da página da conta.
import { money, moneyShort, pctChange } from "./insights";
import { fmtAge, type V2AccountData } from "./v2data";
import type { Account } from "./accounts";

export interface V2Data {
  a: Account;
  d: V2AccountData;
}

// ---------------------------------------------------------------- saúde

export type V2HealthLevel = "act" | "watch" | "flowing" | "nobaseline";

export interface V2Health {
  level: V2HealthLevel;
  label: string;
  reason: string; // motivo em texto, sempre visível ao lado da cor
  dropPct: number | null; // variação do volume vs a média de 4 semanas
  avgWeekly: number; // média semanal de contatos verificados (4 semanas)
}

export const V2_HEALTH_COLOR: Record<V2HealthLevel, string> = {
  act: "#FF6B6B",
  watch: "#FFD97C",
  flowing: "#3DDC84",
  nobaseline: "#8A7A70",
};

const RANK: Record<V2HealthLevel, number> = { act: 4, watch: 3, nobaseline: 2, flowing: 1 };
export function healthRank(l: V2HealthLevel): number {
  return RANK[l];
}

/** Média semanal de verificados nas 4 semanas anteriores à semana atual. */
export function avgWeeklyBefore(d: V2AccountData): number {
  // Dias de 7 a 34 dias atrás: leadsByDay30 cobre 0..29 (índice 0 = 29
  // dias atrás) e leadsByDayPrev30 cobre 30..59 (índice 29 = 30 dias
  // atrás). Janela de 28 dias: índices 1..22 do primeiro (28..7 dias
  // atrás) + índices 25..29 do segundo (34..30 dias atrás) = 27 dias.
  let sum = 0;
  for (let i = 1; i <= 22; i++) sum += d.leadsByDay30V[i];
  for (let i = 25; i <= 29; i++) sum += d.leadsByDayPrev30V[i];
  return (sum / 27) * 7;
}

export function accountHealthV2(d: V2AccountData): V2Health {
  const reasons: { rank: number; text: string }[] = [];
  let worst: V2HealthLevel = "flowing";

  if (d.waitingOldestMin !== null && d.waitingOldestMin > 24 * 60) {
    reasons.push({ rank: 4, text: `waiting ${fmtAge(d.waitingOldestMin)} for a reply` });
    worst = "act";
  }

  const avg = avgWeeklyBefore(d);
  const dropPct = avg > 0 ? Math.round(((d.contacts7dV - avg) / avg) * 100) : null;
  // A cláusula de volume só julga com base mínima (média >= 2/semana);
  // abaixo disso é ruído, não sinal. Calibração registrada na análise.
  if (avg >= 2 && dropPct !== null && dropPct <= -50) {
    reasons.push({ rank: 4, text: `volume down ${Math.abs(dropPct)}% vs the 4-week average` });
    worst = "act";
  } else if (avg >= 2 && dropPct !== null && dropPct <= -25) {
    reasons.push({ rank: 3, text: `volume down ${Math.abs(dropPct)}% vs the 4-week average` });
    if (worst !== "act") worst = "watch";
  }

  if (d.waitingOldestMin !== null && d.waitingOldestMin > 60 && d.waitingOldestMin <= 24 * 60) {
    reasons.push({ rank: 3, text: `waiting ${fmtAge(d.waitingOldestMin)} for a reply` });
    if (worst !== "act") worst = "watch";
  }

  if (d.idleValue > 1000) {
    reasons.push({ rank: 3, text: `${moneyShort(d.idleValue)} of pipeline idle for 14d+` });
    if (worst !== "act") worst = "watch";
  }

  if (reasons.length === 0) {
    if (d.historyContacts === 0) {
      return {
        level: "nobaseline", label: "No baseline",
        reason: "less than 4 weeks of history in the panel window",
        dropPct, avgWeekly: avg,
      };
    }
    return {
      level: "flowing", label: "Flowing",
      reason: d.contacts7dV > 0 ? "queue clear, volume steady" : "queue clear, quiet week",
      dropPct, avgWeekly: avg,
    };
  }

  reasons.sort((x, y) => y.rank - x.rank);
  const label = worst === "act" ? "Act now" : "Watch";
  return { level: worst, label, reason: reasons.slice(0, 2).map((r) => r.text).join(" · "), dropPct, avgWeekly: avg };
}

// ---------------------------------------------------------- pico suspeito

export interface Spike {
  pct: number; // variação 7d vs 7d anterior (contatos limpos, todos)
  share: number; // fração do total do portfólio (7d, limpos)
}

/** Spec 6.2: subida > 300% E > 40% do portfólio vira alerta, não seta verde. */
export function spikeFor(d: V2AccountData, portfolioAll7d: number): Spike | null {
  if (portfolioAll7d <= 0 || d.contacts7dAll < 10) return null;
  const pct = pctChange(d.contacts7dAll, d.contactsPrev7dAll);
  const share = d.contacts7dAll / portfolioAll7d;
  if (pct !== null && pct > 300 && share > 0.4) return { pct, share };
  return null;
}

// ---------------------------------------------------------- action queue

export type QueueKind = "waiting" | "idle" | "drop" | "spike";

export interface QueueItem {
  key: string; // estável: kind:slug (base do Snooze/Done)
  signature: string; // valor da métrica; mudou, o Done perde o efeito
  slug: string;
  account: string;
  kind: QueueKind;
  metric: string; // número grande do item
  headline: string;
  action: string; // o que fazer, em uma frase
  deepLink: string;
  deepLabel: string;
  moneyAtRisk: number;
  severity: 1 | 2 | 3;
}

export function buildQueueV2(
  data: V2Data[],
  hlLinkFor: (slug: string, area: "conversations" | "opportunities" | "dashboard") => string,
): QueueItem[] {
  const items: QueueItem[] = [];
  const portfolioAll7d = data.reduce((s, x) => s + x.d.contacts7dAll, 0);

  for (const { a, d } of data) {
    const health = accountHealthV2(d);

    if (d.waitingCount > 0 && d.waitingOldestMin !== null) {
      items.push({
        key: `waiting:${a.slug}`,
        signature: `${d.waitingCount}:${Math.floor(d.waitingOldestMin / 60)}`,
        slug: a.slug, account: a.name, kind: "waiting",
        metric: `${d.waitingCount}`,
        headline: `${d.waitingCount} conversation${d.waitingCount === 1 ? "" : "s"} waiting, oldest ${fmtAge(d.waitingOldestMin)}`,
        action: "Reply in HighLevel, oldest first",
        deepLink: hlLinkFor(a.slug, "conversations"), deepLabel: "Open conversations",
        moneyAtRisk: d.opportunitiesValue,
        severity: d.waitingOldestMin > 24 * 60 ? 3 : d.waitingOldestMin > 60 ? 2 : 1,
      });
    }

    if (d.idleCount >= 1 && d.idleValue >= 500) {
      items.push({
        key: `idle:${a.slug}`,
        signature: `${Math.round(d.idleValue)}`,
        slug: a.slug, account: a.name, kind: "idle",
        metric: moneyShort(d.idleValue),
        headline: `${money(d.idleValue)} idle for 14d+ · ${d.idleCount} opportunit${d.idleCount === 1 ? "y" : "ies"}`,
        action: "Follow up or close in HighLevel",
        deepLink: hlLinkFor(a.slug, "opportunities"), deepLabel: "Open pipeline",
        moneyAtRisk: d.idleValue,
        severity: d.idleValue >= 5000 ? 2 : 1,
      });
    }

    if (health.dropPct !== null && health.dropPct <= -25 && health.avgWeekly >= 2) {
      items.push({
        key: `drop:${a.slug}`,
        signature: `${d.contacts7dV}`,
        slug: a.slug, account: a.name, kind: "drop",
        metric: `${Math.round(health.avgWeekly)} → ${d.contacts7dV}`,
        headline: `Verified contacts down ${Math.abs(health.dropPct)}% vs the 4-week average`,
        action: "Check the lead source and the form",
        deepLink: hlLinkFor(a.slug, "dashboard"), deepLabel: "Open in HighLevel",
        moneyAtRisk: d.opportunitiesValue,
        severity: health.dropPct <= -50 ? 3 : 2,
      });
    }

    const spike = spikeFor(d, portfolioAll7d);
    if (spike) {
      items.push({
        key: `spike:${a.slug}`,
        signature: `${d.contacts7dAll}`,
        slug: a.slug, account: a.name, kind: "spike",
        metric: `${d.contacts7dAll}`,
        headline: `Contacts jumped +${spike.pct}% and are ${Math.round(spike.share * 100)}% of the portfolio`,
        action: "Check the source before trusting the jump",
        deepLink: `/v2/account/${a.slug}`, deepLabel: "Open the account",
        moneyAtRisk: 0,
        severity: 2,
      });
    }
  }

  return items.sort((x, y) => y.moneyAtRisk - x.moneyAtRisk || y.severity - x.severity);
}

// ------------------------------------------------------------- 3 linhas

/** "This week in 3 lines": os 3 maiores problemas, por regra, com números. */
export function buildThreeLines(data: V2Data[]): string[] {
  const lines: { score: number; text: string }[] = [];

  const totalWaiting = data.reduce((s, x) => s + x.d.waitingCount, 0);
  if (totalWaiting > 0) {
    const worst = [...data].filter((x) => x.d.waitingCount > 0).sort((x, y) => y.d.waitingCount - x.d.waitingCount)[0];
    const oldest = Math.max(...data.map((x) => x.d.waitingOldestMin ?? 0));
    lines.push({
      score: 1000 + totalWaiting,
      text: `${totalWaiting} conversation${totalWaiting === 1 ? "" : "s"} waiting for a reply, ${worst.d.waitingCount} at ${worst.a.name}, the oldest for ${fmtAge(oldest)}.`,
    });
  }

  const idleTotal = data.reduce((s, x) => s + x.d.idleValue, 0);
  if (idleTotal > 0) {
    const k = data.filter((x) => x.d.idleValue > 0).length;
    lines.push({
      score: 500 + idleTotal / 100,
      text: `${money(idleTotal)} of open pipeline has not moved in 14+ days, across ${k} account${k === 1 ? "" : "s"}.`,
    });
  }

  const portfolioAll7d = data.reduce((s, x) => s + x.d.contacts7dAll, 0);
  for (const { a, d } of data) {
    const spike = spikeFor(d, portfolioAll7d);
    if (spike) {
      lines.push({
        score: 900,
        text: `${a.name} jumped +${spike.pct}% in contacts and is ${Math.round(spike.share * 100)}% of the portfolio: check the source before trusting it.`,
      });
    }
    const h = accountHealthV2(d);
    if (h.dropPct !== null && h.dropPct <= -50 && h.avgWeekly >= 2) {
      lines.push({
        score: 800 + Math.abs(h.dropPct),
        text: `${a.name} verified contacts fell ${Math.abs(h.dropPct)}% against its own 4-week average.`,
      });
    }
  }

  const wonTotal = data.reduce((s, x) => s + x.d.won30Value, 0);
  const contactsTotal = data.reduce((s, x) => s + x.d.contacts7dV, 0);
  lines.sort((x, y) => y.score - x.score);
  const out = lines.slice(0, 3).map((l) => l.text);
  if (out.length < 3) {
    out.push(`${contactsTotal} verified contacts arrived in the last 7 days across ${data.length} live accounts.`);
  }
  if (out.length < 3 && wonTotal > 0) {
    out.push(`${money(wonTotal)} was won in the last 30 days.`);
  }
  if (out.length < 3) {
    out.push("No account crossed a risk threshold this week.");
  }
  return out.slice(0, 3);
}

// ------------------------------------------------------------- diagnóstico

/**
 * Frase de diagnóstico da página da conta: onde está o maior vazamento.
 * gsc entra quando existe (regra do exemplo da spec: impressões sem
 * clique são a ação nº 1 da conta).
 */
export function diagnosisFor(
  d: V2AccountData,
  gsc?: { impressions28: number; clicks28: number } | null,
): string {
  if (d.waitingOldestMin !== null && d.waitingOldestMin > 24 * 60) {
    return `The leak is response time: ${d.waitingCount} conversation${d.waitingCount === 1 ? "" : "s"} waiting, the oldest for ${fmtAge(d.waitingOldestMin)}. Every hour of delay cuts the chance of qualifying the lead.`;
  }
  if (gsc && gsc.impressions28 >= 100 && gsc.clicks28 === 0) {
    return `Google shows this business but nobody clicks: ${gsc.impressions28.toLocaleString("en-US")} impressions and 0 clicks in 28 days. Fix the page titles and meta descriptions first.`;
  }
  if (d.idleValue > 1000) {
    return `Money is parked: ${money(d.idleValue)} of open pipeline has not moved in 14+ days. Follow up or close each one.`;
  }
  const h = accountHealthV2(d);
  if (h.dropPct !== null && h.dropPct <= -25 && h.avgWeekly >= 2) {
    return `Volume is slipping: verified contacts are down ${Math.abs(h.dropPct)}% against the 4-week average. Check the lead source before anything else.`;
  }
  if (d.waitingOldestMin !== null && d.waitingOldestMin > 60) {
    return `${d.waitingCount} conversation${d.waitingCount === 1 ? "" : "s"} waiting for a reply, the oldest for ${fmtAge(d.waitingOldestMin)}. Clear the queue today.`;
  }
  return "No leak above threshold right now: the queue is clear and volume is steady. Keep the rhythm.";
}

export { money, moneyShort };
