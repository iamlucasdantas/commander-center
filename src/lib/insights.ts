// Camada de decisão da Fase 2: transforma as métricas brutas do HighLevel
// em health score por conta, fila de atenção ordenada por dinheiro em
// risco e o feed "what changed". Funções puras, sem fetch: tudo sai dos
// dados que hl.ts já coletou.
//
// Direção visual (Lucas, 2026-11-22): interface quase sem texto. Por isso
// esta camada entrega números, escores e microrrótulos (até ~4 palavras);
// frases longas só vivem nos tooltips.
import type { Account } from "./accounts";
import type { AccountMetrics } from "./hl";

export interface AccountData {
  a: Account;
  m: AccountMetrics;
}

/** Variação percentual de cur contra prev. null quando não há base. */
export function pctChange(cur: number, prev: number): number | null {
  if (prev <= 0) return cur > 0 ? 100 : null;
  return Math.round(((cur - prev) / prev) * 100);
}

export function money(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** $4,200 → "$4.2k", $850 → "$850". Para microrrótulos e barras. */
export function moneyShort(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(v)}`;
}

/** Fração da média do portfólio (leads 7d das contas vivas). */
export function vsAverage(value: number, average: number): string | null {
  if (!average || average <= 0) return null;
  const pct = Math.round((value / average - 1) * 100);
  if (pct === 0) return "at portfolio average";
  return pct > 0 ? `+${pct}% vs portfolio average` : `${pct}% vs portfolio average`;
}

// ---------------------------------------------------------------- health

export type HealthLevel = "green" | "yellow" | "red";

export interface Health {
  level: HealthLevel;
  label: string; // "Red", "Yellow", "Green"
  score: number; // 0-100, alimenta o anel visual
  reasons: string[]; // motivos completos (tooltip)
  short: string; // microrrazão de até ~4 palavras, visível na linha
}

export function accountHealth(m: AccountMetrics): Health {
  const reasons: string[] = [];
  const shorts: string[] = [];
  let score = 100;
  let worst = 0; // 0 ok, 1 atenção, 2 problema

  if (m.unread >= 100) {
    reasons.push(`${m.unread} unread conversations waiting`);
    shorts.push(`${m.unread} unread`);
    score -= 45; worst = Math.max(worst, 2);
  } else if (m.unread >= 25) {
    reasons.push(`${m.unread} unread conversations waiting`);
    shorts.push(`${m.unread} unread`);
    score -= 25; worst = Math.max(worst, 1);
  } else if (m.unread > 0) {
    reasons.push(`${m.unread} unread conversation${m.unread === 1 ? "" : "s"} waiting`);
    shorts.push(`${m.unread} unread`);
    score -= 8;
  }

  const drop = m.leadsPrev7d > 0 ? (m.leads7d - m.leadsPrev7d) / m.leadsPrev7d : null;
  if (m.leadsPrev7d >= 5 && drop !== null && drop <= -0.5) {
    reasons.push(`leads down ${Math.abs(Math.round(drop * 100))}% week over week (${m.leadsPrev7d} to ${m.leads7d})`);
    shorts.push(`leads ${Math.round(drop * 100)}% WoW`);
    score -= 35; worst = Math.max(worst, 2);
  } else if (m.leadsPrev7d >= 3 && drop !== null && drop <= -0.2) {
    reasons.push(`leads down ${Math.abs(Math.round(drop * 100))}% week over week (${m.leadsPrev7d} to ${m.leads7d})`);
    shorts.push(`leads ${Math.round(drop * 100)}% WoW`);
    score -= 18; worst = Math.max(worst, 1);
  }

  if (m.leads7d === 0 && m.leadsPrev7d >= 3) {
    reasons.push("no new leads this week");
    shorts.push("zero leads this week");
    score -= 35; worst = Math.max(worst, 2);
  } else if (m.leads7d === 0 && m.totalContacts > 0) {
    reasons.push("no new leads this week");
    shorts.push("zero leads this week");
    score -= 12; worst = Math.max(worst, 1);
  }

  if (m.oppStaleValue >= 500) {
    reasons.push(`${money(m.oppStaleValue)} in open pipeline idle for 14+ days`);
    shorts.push(`${moneyShort(m.oppStaleValue)} idle pipeline`);
    score -= m.oppStaleValue >= 2000 ? 15 : 8;
    worst = Math.max(worst, 1);
  }

  if (reasons.length === 0) {
    reasons.push(m.leads7d > 0 ? "leads flowing, queue under control" : "quiet week, nothing waiting");
    shorts.push(m.leads7d > 0 ? "flowing" : "quiet");
  }

  const level: HealthLevel = worst >= 2 ? "red" : worst === 1 ? "yellow" : "green";
  const label = level === "red" ? "Red" : level === "yellow" ? "Yellow" : "Green";
  return { level, label, score: Math.max(5, Math.min(100, score)), reasons, short: shorts[0] };
}

// ---------------------------------------------------------- attention queue

export interface AttentionItem {
  slug: string;
  account: string;
  headline: string; // microrrótulo do problema, ex.: "176 unread conversations"
  metric: string; // número grande do item, ex.: "176" ou "$4.2k"
  action: string; // microação, ex.: "Reply oldest first"
  severity: 1 | 2 | 3; // 3 = agir agora
  moneyAtRisk: number; // alimenta a barra de dinheiro em risco
}

/**
 * Fila do que precisa do Lucas agora, ordenada por severidade e, dentro
 * dela, por dinheiro em risco (pipeline aberto da conta).
 */
export function buildAttentionQueue(data: AccountData[]): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const { a, m } of data) {
    if (m.unread >= 10) {
      items.push({
        slug: a.slug,
        account: a.name,
        headline: `${m.unread} unread conversations`,
        metric: `${m.unread}`,
        action: "Reply oldest first",
        severity: m.unread >= 100 ? 3 : m.unread >= 25 ? 2 : 1,
        moneyAtRisk: m.opportunitiesValue,
      });
    }

    const drop = m.leadsPrev7d > 0 ? (m.leads7d - m.leadsPrev7d) / m.leadsPrev7d : null;
    if (m.leadsPrev7d >= 4 && drop !== null && drop <= -0.4) {
      items.push({
        slug: a.slug,
        account: a.name,
        headline: m.leads7d === 0 ? `Leads ${m.leadsPrev7d} → 0 this week` : `Leads down ${Math.abs(Math.round(drop * 100))}% WoW`,
        metric: `${m.leadsPrev7d} → ${m.leads7d}`,
        action: "Check source and form",
        severity: drop <= -0.6 || m.leads7d === 0 ? 3 : 2,
        moneyAtRisk: m.opportunitiesValue,
      });
    }

    if (m.oppStaleCount >= 1 && m.oppStaleValue >= 500) {
      items.push({
        slug: a.slug,
        account: a.name,
        headline: `${moneyShort(m.oppStaleValue)} idle 14d+ · ${m.oppStaleCount} opportunit${m.oppStaleCount === 1 ? "y" : "ies"}`,
        metric: moneyShort(m.oppStaleValue),
        action: "Follow up or close",
        severity: m.oppStaleValue >= 5000 ? 2 : 1,
        moneyAtRisk: m.oppStaleValue,
      });
    }
  }

  return items
    .sort((x, y) => y.severity - x.severity || y.moneyAtRisk - x.moneyAtRisk)
    .slice(0, 6);
}

// ------------------------------------------------------------- what changed

export interface ChangeItem {
  text: string; // linha compacta, ex.: "The Bar: leads 12 → 31 (+158%)"
  tone: "good" | "bad" | "neutral";
  impact: number; // ordena o feed: maior impacto primeiro
}

export function buildWhatChanged(data: AccountData[], totals: { leads7d: number; leadsPrev7d: number }): ChangeItem[] {
  const items: ChangeItem[] = [];

  const totalPct = pctChange(totals.leads7d, totals.leadsPrev7d);
  if (totalPct !== null && Math.abs(totalPct) >= 15 && totals.leadsPrev7d >= 5) {
    items.push({
      text: `Portfolio: leads ${totals.leadsPrev7d} → ${totals.leads7d} (${totalPct > 0 ? "+" : ""}${totalPct}%)`,
      tone: totalPct > 0 ? "good" : "bad",
      impact: Math.abs(totals.leads7d - totals.leadsPrev7d) + 100,
    });
  }

  for (const { a, m } of data) {
    const pct = pctChange(m.leads7d, m.leadsPrev7d);
    if (m.leadsPrev7d >= 3 && pct !== null && pct >= 50) {
      items.push({
        text: `${a.name}: leads ${m.leadsPrev7d} → ${m.leads7d} (+${pct}%)`,
        tone: "good",
        impact: Math.abs(m.leads7d - m.leadsPrev7d) + 40,
      });
    } else if (m.leadsPrev7d >= 3 && pct !== null && pct <= -40) {
      items.push({
        text: `${a.name}: leads ${m.leadsPrev7d} → ${m.leads7d} (${pct}%)`,
        tone: "bad",
        impact: Math.abs(m.leads7d - m.leadsPrev7d) + 40,
      });
    }

    if (m.unreadHot7d >= 20) {
      items.push({
        text: `${a.name}: ${m.unreadHot7d} unread active this week`,
        tone: "bad",
        impact: m.unreadHot7d,
      });
    }

    if (m.oppNew7d >= 3) {
      items.push({
        text: `${a.name}: ${m.oppNew7d} new opportunities · ${moneyShort(m.oppNew7dValue)}`,
        tone: "good",
        impact: m.oppNew7d * 5,
      });
    }
  }

  return items.sort((x, y) => y.impact - x.impact).slice(0, 6);
}
