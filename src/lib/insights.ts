// Camada de decisão da Fase 2: transforma as métricas brutas do HighLevel
// em health score por conta, fila de atenção ordenada por dinheiro em
// risco e o feed "what changed". Funções puras, sem fetch: tudo sai dos
// dados que hl.ts já coletou.
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

/** Fração da média do portfólio (leads 7d das contas vivas). */
export function vsAverage(value: number, average: number): string | null {
  if (!average || average <= 0) return null;
  const pct = Math.round((value / average - 1) * 100);
  if (pct === 0) return "at the portfolio average";
  return pct > 0 ? `${pct}% above the portfolio average` : `${Math.abs(pct)}% below the portfolio average`;
}

// ---------------------------------------------------------------- health

export type HealthLevel = "green" | "yellow" | "red";

export interface Health {
  level: HealthLevel;
  label: string; // "Red", "Yellow", "Green"
  reasons: string[]; // motivos escritos, sempre presentes
}

export function accountHealth(m: AccountMetrics): Health {
  const reasons: string[] = [];
  let score = 0; // 0 = ok, 1 = atenção, 2 = problema

  if (m.unread >= 100) {
    reasons.push(`${m.unread} unread conversations waiting`);
    score = Math.max(score, 2);
  } else if (m.unread >= 25) {
    reasons.push(`${m.unread} unread conversations waiting`);
    score = Math.max(score, 1);
  } else if (m.unread > 0) {
    reasons.push(`${m.unread} unread conversation${m.unread === 1 ? "" : "s"} waiting`);
  }

  const drop = m.leadsPrev7d > 0 ? (m.leads7d - m.leadsPrev7d) / m.leadsPrev7d : null;
  if (m.leadsPrev7d >= 5 && drop !== null && drop <= -0.5) {
    reasons.push(`leads down ${Math.abs(Math.round(drop * 100))}% week over week (${m.leadsPrev7d} to ${m.leads7d})`);
    score = Math.max(score, 2);
  } else if (m.leadsPrev7d >= 3 && drop !== null && drop <= -0.2) {
    reasons.push(`leads down ${Math.abs(Math.round(drop * 100))}% week over week (${m.leadsPrev7d} to ${m.leads7d})`);
    score = Math.max(score, 1);
  }

  if (m.leads7d === 0 && m.leadsPrev7d >= 3) {
    reasons.push("no new leads this week");
    score = Math.max(score, 2);
  } else if (m.leads7d === 0 && m.totalContacts > 0) {
    reasons.push("no new leads this week");
    score = Math.max(score, 1);
  }

  if (m.oppStaleValue >= 2000) {
    reasons.push(`${money(m.oppStaleValue)} in open pipeline idle for 14+ days`);
    score = Math.max(score, 1);
  } else if (m.oppStaleValue >= 500) {
    reasons.push(`${money(m.oppStaleValue)} in open pipeline idle for 14+ days`);
    score = Math.max(score, 1);
  }

  if (reasons.length === 0) {
    reasons.push(m.leads7d > 0 ? "leads flowing, queue under control" : "quiet week, nothing waiting");
  }

  const level: HealthLevel = score >= 2 ? "red" : score === 1 ? "yellow" : "green";
  const label = level === "red" ? "Red" : level === "yellow" ? "Yellow" : "Green";
  return { level, label, reasons };
}

// ---------------------------------------------------------- attention queue

export interface AttentionItem {
  slug: string;
  account: string;
  problem: string;
  proof: string;
  action: string;
  severity: 1 | 2 | 3; // 3 = agir agora
  moneyAtRisk: number;
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
        problem: `${m.unread} unread conversations waiting for a reply`,
        proof: `${m.unreadConversations} open conversations, ${money(m.opportunitiesValue)} in open pipeline in this account${m.unreadHot7d ? `, ${m.unreadHot7d} of them active in the last 7 days` : ""}.`,
        action: "Work the queue oldest first, money conversations before support.",
        severity: m.unread >= 100 ? 3 : m.unread >= 25 ? 2 : 1,
        moneyAtRisk: m.opportunitiesValue,
      });
    }

    const drop = m.leadsPrev7d > 0 ? (m.leads7d - m.leadsPrev7d) / m.leadsPrev7d : null;
    if (m.leadsPrev7d >= 4 && drop !== null && drop <= -0.4) {
      items.push({
        slug: a.slug,
        account: a.name,
        problem: m.leads7d === 0
          ? `Leads dropped to zero this week (was ${m.leadsPrev7d} last week)`
          : `Leads fell ${Math.abs(Math.round(drop * 100))}% week over week (${m.leadsPrev7d} to ${m.leads7d})`,
        proof: `${m.leads30d} clean leads in the last 30 days, ${m.totalContacts} contacts in the base.`,
        action: "Check the lead source and the site form before spending more on traffic.",
        severity: drop <= -0.6 || m.leads7d === 0 ? 3 : 2,
        moneyAtRisk: m.opportunitiesValue,
      });
    }

    if (m.oppStaleCount >= 1 && m.oppStaleValue >= 500) {
      items.push({
        slug: a.slug,
        account: a.name,
        problem: `${money(m.oppStaleValue)} in open pipeline has not moved in 14+ days`,
        proof: `${m.oppStaleCount} stale opportunit${m.oppStaleCount === 1 ? "y" : "ies"} out of ${m.opportunitiesOpen} open.`,
        action: "Follow up today or close them, stale pipeline inflates the forecast.",
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
  text: string;
  tone: "good" | "bad" | "neutral";
  impact: number; // ordena o feed: maior impacto primeiro
}

export function buildWhatChanged(data: AccountData[], totals: { leads7d: number; leadsPrev7d: number }): ChangeItem[] {
  const items: ChangeItem[] = [];

  const totalPct = pctChange(totals.leads7d, totals.leadsPrev7d);
  if (totalPct !== null && Math.abs(totalPct) >= 15 && totals.leadsPrev7d >= 5) {
    items.push({
      text: `Portfolio leads: ${totals.leads7d} this week vs ${totals.leadsPrev7d} last week (${totalPct > 0 ? "+" : ""}${totalPct}%).`,
      tone: totalPct > 0 ? "good" : "bad",
      impact: Math.abs(totals.leads7d - totals.leadsPrev7d) + 100,
    });
  }

  for (const { a, m } of data) {
    const pct = pctChange(m.leads7d, m.leadsPrev7d);
    if (m.leadsPrev7d >= 3 && pct !== null && pct >= 50) {
      items.push({
        text: `${a.name}: leads jumped from ${m.leadsPrev7d} to ${m.leads7d} (+${pct}%).`,
        tone: "good",
        impact: Math.abs(m.leads7d - m.leadsPrev7d) + 40,
      });
    } else if (m.leadsPrev7d >= 3 && pct !== null && pct <= -40) {
      items.push({
        text: m.leads7d === 0
          ? `${a.name}: no new leads this week (was ${m.leadsPrev7d} last week).`
          : `${a.name}: leads fell from ${m.leadsPrev7d} to ${m.leads7d} (${pct}%).`,
        tone: "bad",
        impact: Math.abs(m.leads7d - m.leadsPrev7d) + 40,
      });
    }

    if (m.unreadHot7d >= 20) {
      items.push({
        text: `${a.name}: ${m.unreadHot7d} conversations went unread with activity in the last 7 days, the queue is growing.`,
        tone: "bad",
        impact: m.unreadHot7d,
      });
    }

    if (m.oppNew7d >= 3) {
      items.push({
        text: `${a.name}: ${m.oppNew7d} new open opportunities this week worth ${money(m.oppNew7dValue)}.`,
        tone: "good",
        impact: m.oppNew7d * 5,
      });
    }
  }

  return items.sort((x, y) => y.impact - x.impact).slice(0, 6);
}
