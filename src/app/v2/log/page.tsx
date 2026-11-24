import { getState, stateConfigured, type LogEntry } from "@/lib/state";
import GroupedLog from "@/components/v2/GroupedLog";
import { groupLogEntries } from "@/lib/v2log";

export const dynamic = "force-dynamic";

/**
 * Log do /v2, AGRUPADO por (tipo de ação + minuto + execução):
 * a gravação triplicada histórica (cada "DND reversal" escrito 3
 * vezes em 2026-11-22) aparece como UMA linha com o selo "×3
 * entries grouped", e os nomes ficam no detalhe expansível.
 * Agrupamento é leitura pura sobre o panel-state atual (lib/v2log,
 * compartilhado com a aba Log da página da conta): nenhuma entrada
 * é apagada, regravada ou limpa por esta página, e a versão atual
 * do log não muda. A correção de idempotência na ESCRITA (spec
 * 6.1) ficou adiada de propósito: o agrupamento resolve a leitura
 * sem tocar no caminho de escrita da versão atual.
 */
export default async function V2LogPage() {
  const entries: LogEntry[] = stateConfigured() ? (await getState(0)).log : [];
  const list = groupLogEntries(entries);

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
        (spec item 6.1) is intentionally deferred: grouping fixes the reading without touching the current version's write path.
      </p>
    </div>
  );
}
