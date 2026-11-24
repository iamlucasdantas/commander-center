import { getState, stateConfigured, type LogEntry } from "@/lib/state";
import GroupedLog, { type LogGroup } from "@/components/v2/GroupedLog";
import { TZ } from "@/components/viz";

export const dynamic = "force-dynamic";

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

/**
 * Log do /v2, AGRUPADO por (tipo de ação + minuto + execução):
 * a gravação triplicada histórica (cada "DND reversal" escrito 3
 * vezes em 2026-11-22) aparece como UMA linha com o selo "×3
 * entries grouped", e os nomes ficam no detalhe expansível.
 * Agrupamento é leitura pura sobre o panel-state atual: nenhuma
 * entrada é apagada, regravada ou limpa por esta página, e a
 * versão atual do log não muda. A correção de idempotência na
 * ESCRITA (spec 6.1) ficou adiada de propósito nesta rodada:
 * o agrupamento resolve a leitura sem tocar no caminho de
 * escrita da versão atual.
 */
export default async function V2LogPage() {
  const entries: LogEntry[] = stateConfigured() ? (await getState(0)).log : [];

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
  const list = [...groups.values()].sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <div>
      <h1 style={{ fontSize: 24 }}>Panel <span className="flame">log</span></h1>
      <p className="sub">
        {entries.length} entries grouped into {list.length} lines · grouped by action, minute and run · names live in the details ·
        read-only grouping, nothing was deleted or rewritten
      </p>
      <div className="card">
        <GroupedLog groups={list} />
      </div>
      <p className="foot">
        Manual entries are still added from each account page in the current version. The write-side idempotency fix
        (spec item 6.1) is intentionally deferred in this round: grouping fixes the reading without touching the current version's write path.
      </p>
    </div>
  );
}
