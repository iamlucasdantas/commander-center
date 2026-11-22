// Armazenamento INTERNO do Commander Center (correções do Lucas,
// 2026-11-22 15:02 e 15:03): a verificação manual de leads NÃO escreve
// nada no HighLevel (nada de tag); ela vive só aqui, junto com o
// registro de quem a automação de DND de 7 dias já aplicou e com o LOG
// do painel (ações automáticas + entradas manuais do Lucas).
//
// Onde fica: um único documento JSON ("panel-state.json") numa Vercel
// Blob store PRIVADA do próprio projeto ("commander-center-state",
// criada em 2026-11-22 e ligada ao projeto; o token chega pela env
// BLOB_READ_WRITE_TOKEN). É o armazenamento durável mais simples
// disponível neste projeto: sem banco novo, sem dependência de outro
// sistema, leitura e escrita por fetch via SDK oficial. Trade-off
// assumido e documentado: documento único com leitura-modificação-
// escrita; com um único operador (o Lucas) a chance de escrita
// concorrente se perder é mínima, e nenhuma ação crítica depende só
// deste registro (o DND é idempotente pelo próprio HighLevel).
import { list, put } from "@vercel/blob";

const PATHNAME = "panel-state.json";
const LOG_CAP = 2000;

export interface LogEntry {
  id: string;
  at: string; // ISO
  slug: string | null; // conta dona da entrada (null = painel inteiro)
  account: string; // nome de exibição da conta
  action: string; // manual-verify | dnd-automation | delete-unverified | partner-separate | manual
  kind: "log" | "task"; // Tipo: Log ou Tarefa (manual); automático é sempre "log"
  status: "pending" | "completed"; // Pendente | Concluída
  title: string;
  detail?: string;
}

export interface PanelState {
  verified: Record<string, string[]>; // slug -> ids marcados como verificados à mão (interno)
  dndApplied: Record<string, string[]>; // slug -> ids que a automação de 7 dias pôs em DND
  log: LogEntry[];
}

const EMPTY: PanelState = { verified: {}, dndApplied: {}, log: [] };

let memCache: { at: number; state: PanelState } | null = null;

export function stateConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readRemote(): Promise<PanelState> {
  try {
    const { blobs } = await list({ prefix: PATHNAME, limit: 5 });
    const b = blobs.find((x) => x.pathname === PATHNAME);
    if (!b) return { verified: {}, dndApplied: {}, log: [] };
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    for (const url of [b.downloadUrl, b.url]) {
      try {
        const res = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          cache: "no-store",
        });
        if (res.ok) {
          const data = (await res.json()) as Partial<PanelState>;
          return {
            verified: data.verified ?? {},
            dndApplied: data.dndApplied ?? {},
            log: data.log ?? [],
          };
        }
      } catch { /* tenta a próxima URL */ }
    }
    return { verified: {}, dndApplied: {}, log: [] };
  } catch {
    return { verified: {}, dndApplied: {}, log: [] };
  }
}

/** Estado atual, com cache curto em memória (15s) para a coleta não ler a Blob a cada conta. */
export async function getState(maxAgeMs = 15_000): Promise<PanelState> {
  if (!stateConfigured()) return EMPTY;
  if (memCache && Date.now() - memCache.at < maxAgeMs) return memCache.state;
  const s = await readRemote();
  memCache = { at: Date.now(), state: s };
  return s;
}

/** Lê fresco, aplica a mutação e grava. Devolve o estado novo. */
export async function mutateState(fn: (s: PanelState) => void): Promise<PanelState> {
  const s = await readRemote();
  fn(s);
  if (s.log.length > LOG_CAP) s.log = s.log.slice(s.log.length - LOG_CAP);
  await put(PATHNAME, JSON.stringify(s), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  memCache = { at: Date.now(), state: s };
  return s;
}

export function makeLogEntry(e: Omit<LogEntry, "id" | "at">): LogEntry {
  return {
    ...e,
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
  };
}

/** Acrescenta entradas ao log. Nunca derruba a ação que a chamou. */
export async function appendLog(entries: LogEntry[]): Promise<void> {
  if (!stateConfigured() || entries.length === 0) return;
  try {
    await mutateState((s) => {
      s.log.push(...entries);
    });
  } catch { /* o log é registro, não pode quebrar a ação principal */ }
}
