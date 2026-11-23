// Snapshots da central de comando (unificação, ordem do Lucas,
// 2026-11-22): AGENDA (Outlook + Google + HighLevel, deduplicada
// favorecendo o Outlook) e VERCEL (projetos e deploys). Mesmo padrão
// dos snapshots de analytics: os conectores rodam no ambiente da
// Muse, um coletor diário lê as fontes e grava aqui via
// POST /api/collector/ingest; o painel só LÊ este documento.
// Documento próprio no Blob, `command-state.json`, separado do
// panel-state.json (ações do painel) e do analytics-state.json
// (coletor de analytics), para nenhuma escrita disputar com a outra.
//
// Regra de honestidade: snapshot ausente aparece como pendência
// ("aguardando a primeira coleta"), nunca como dado inventado.
// Nenhuma escrita sai daqui para Outlook, Google, HighLevel ou
// Vercel: as visões são de leitura.

import { get, put } from "@vercel/blob";

export type AgendaSource = "outlook" | "google" | "highlevel";

export interface AgendaEvent {
  /** source + id da fonte, estável entre coletas. */
  id: string;
  title: string;
  /** Instantes ISO (UTC). Em evento de dia inteiro, start/end são as datas em Chicago à meia-noite. */
  start: string;
  end: string;
  allDay: boolean;
  source: AgendaSource;
  /** Nome do calendário de origem (no HighLevel, o nome do calendário; no Google, o calendário). */
  calendar?: string;
  location?: string;
}

export interface AgendaSnapshot {
  collectedAt: string; // ISO
  /** Janela coletada, datas em America/Chicago (YYYY-MM-DD). */
  windowStart: string;
  windowEnd: string;
  events: AgendaEvent[];
  /** Contagens por fonte DEPOIS da deduplicação, e quantos duplicados caíram. */
  counts: { outlook: number; google: number; highlevel: number; duplicatesRemoved: number };
  /** Falhas por fonte na última coleta (a fonte fica fora, as outras entram). */
  errors: string[];
}

export interface VercelDeployment {
  id: string;
  /** READY, ERROR, BUILDING, QUEUED, CANCELED... como a Vercel devolve. */
  state: string;
  target: string | null; // "production" | "preview" | null
  createdAt: string; // ISO
  /** URL própria do deploy (subdomínio do deploy). */
  url: string;
  inspectorUrl: string;
  commitSha?: string;
  commitMessage?: string;
  branch?: string;
}

export interface VercelProjectSnap {
  id: string;
  name: string;
  updatedAt: string; // ISO
  /** Domínio de produção principal, quando a Vercel lista um. */
  productionDomain?: string;
  /** Deploys mais recentes primeiro (a coleta limita a 8 por projeto). */
  deployments: VercelDeployment[];
}

export interface VercelSnapshot {
  collectedAt: string; // ISO
  projects: VercelProjectSnap[];
  errors: string[];
}

export interface CommandState {
  agenda?: AgendaSnapshot;
  vercel?: VercelSnapshot;
}

const COMMAND_PATH = "command-state.json";

function emptyCommand(): CommandState {
  return {};
}

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function normalize(raw: unknown): CommandState {
  const s = emptyCommand();
  if (!isObj(raw)) return s;
  if (isObj(raw.agenda) && typeof raw.agenda.collectedAt === "string" && Array.isArray(raw.agenda.events)) {
    s.agenda = raw.agenda as unknown as AgendaSnapshot;
  }
  if (isObj(raw.vercel) && typeof raw.vercel.collectedAt === "string" && Array.isArray(raw.vercel.projects)) {
    s.vercel = raw.vercel as unknown as VercelSnapshot;
  }
  return s;
}

export function commandConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function readRemote(): Promise<CommandState> {
  if (!commandConfigured()) return emptyCommand();
  try {
    const res = await get(COMMAND_PATH, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return emptyCommand();
    const text = await new Response(res.stream).text();
    return normalize(JSON.parse(text));
  } catch {
    return emptyCommand();
  }
}

let memCache: { at: number; state: CommandState } | null = null;
const MEM_TTL_MS = 60_000;

/** Estado atual dos snapshots; maxAgeMs 0 força leitura fresca. */
export async function getCommand(maxAgeMs = MEM_TTL_MS): Promise<CommandState> {
  if (memCache && Date.now() - memCache.at < maxAgeMs) return memCache.state;
  const s = await readRemote();
  memCache = { at: Date.now(), state: s };
  return s;
}

/**
 * Grava as seções coletadas por cima das anteriores, com a mesma
 * disciplina dos outros documentos: confere um nonce após escrever
 * e tenta de novo se outra escrita atropelar. Cada seção (agenda,
 * vercel) é substituída inteira pela coleta nova, porque o coletor
 * sempre manda a seção completa e fresca.
 */
export async function ingestCommand(payload: Partial<CommandState>): Promise<CommandState> {
  let last = await readRemote();
  for (let attempt = 0; attempt < 3; attempt++) {
    const working = normalize(JSON.parse(JSON.stringify(last)));
    if (payload.agenda) working.agenda = payload.agenda;
    if (payload.vercel) working.vercel = payload.vercel;
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await put(COMMAND_PATH, JSON.stringify({ ...working, _nonce: nonce }), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    const back = await readRemote();
    memCache = { at: Date.now(), state: back };
    if ((back as CommandState & { _nonce?: string })._nonce === nonce) return back;
    last = back;
  }
  return last;
}
