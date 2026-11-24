// Agrupamento do log do /v2 (spec 2026-11-24, seção 4), COMPARTILHADO
// entre a página /v2/log e a aba Log da página da conta (etapa 4):
// uma linha por (tipo de ação + minuto + execução), com a contagem
// por conta e os nomes só no detalhe expansível. É transformação de
// LEITURA sobre as entradas do panel-state: nada é apagado nem
// regravado, e a versão atual do log continua como está.
import type { LogEntry } from "./state";
import type { LogGroup } from "@/components/v2/GroupedLog";
import { TZ } from "@/components/viz";

const ACTION_LABEL: Record<string, string> = {
  "manual-verify": "Manual verification",
  "dnd-automation": "DND automation",
  "dnd-revert": "DND reversal",
  "delete-unverified": "Deletion",
  "partner-separate": "Partner separation",
  manual: "Manual entry",
};

function minuteKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16); // até o minuto, em UTC
}

function minuteLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

/** Agrupa as entradas (já filtradas, se for o caso) e ordena da mais nova para a mais antiga. */
export function groupLogEntries(entries: LogEntry[]): LogGroup[] {
  const groups = new Map<string, LogGroup & { details: string[] }>();
  for (const e of entries) {
    const key = `${e.action}|${e.slug}|${minuteKey(e.at)}|${e.title}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      if (e.detail) g.details.push(e.detail);
      if (e.at > g.at) g.at = e.at;
    } else {
      groups.set(key, {
        key,
        at: e.at,
        minuteLabel: minuteLabel(e.at),
        actionLabel: ACTION_LABEL[e.action] ?? e.action,
        account: e.account,
        title: e.title,
        count: 1,
        kind: e.kind,
        status: e.status,
        details: e.detail ? [e.detail] : [],
      });
    }
  }
  return [...groups.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
}
