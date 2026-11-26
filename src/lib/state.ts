// Estado INTERNO do painel (correções do Lucas, 2026-11-22 15:02 e
// 15:03): marcações de verificado feitas à mão, o LOG do painel
// (entradas automáticas das ações + entradas manuais dele) e o
// registro HISTÓRICO dos DNDs que uma versão intermediária da regra
// dos 7 dias chegou a aplicar no HighLevel em 2026-11-22 (a automação
// foi DESLIGADA na correção das 15:25 e os DNDs foram revertidos; o
// registro fica como evidência de exatamente quem ela tinha atingido).
// NADA disso é a tag "lead-verified" nem escrita de verificação no
// HighLevel: a verificação é interna e a regra dos 7 dias é só de
// leitura (esconder do painel), sem nenhuma escrita no HighLevel.
//
// Armazenamento: Blob store PRIVADA do próprio projeto no Vercel
// ("commander-center-state"), num documento JSON único,
// `panel-state.json`. É o armazenamento durável mais simples que o
// projeto tem: nenhuma dependência nova de banco, nenhum sistema
// externo, e o token já vem da env BLOB_READ_WRITE_TOKEN, criada
// automaticamente ao ligar a store ao projeto. O preço é um documento
// só, lido e regravado por inteiro a cada mudança (leitura-modificação-
// escrita); com um operador só (o Lucas) e o volume atual, isso é
// seguro o bastante, e a escrita confere a própria gravação e tenta de
// novo se outra escrita simultânea a atropelar (ver mutateState).
//
// Leitura SEMPRE pela origem (get com useCache: false): a primeira
// versão lia pela URL de download e caía no cache de CDN, devolvendo
// versões velhas do documento minutos depois de uma escrita. Escrita e
// leitura no mesmo fuso de instância passam por um cache em memória de
// 15 segundos para não martelar a store a cada coleta.

import { get, put } from "@vercel/blob";

export interface DndRecord {
  id: string;
  /** ISO de quando a automação (desligada em 2026-11-22) aplicou o DND. */
  at: string;
}

export interface LogEntry {
  id: string;
  /** ISO da gravação; a exibição converte para America/Chicago. */
  at: string;
  slug: string;
  account: string;
  action: "manual-verify" | "dnd-automation" | "dnd-revert" | "delete-unverified" | "partner-separate" | "manual" | "agent";
  /** Quem gravou, quando foi um agente do OpenBot (ex.: "Account Manager"). */
  by?: string;
  kind: "log" | "task";
  status: "pending" | "completed";
  title: string;
  detail?: string;
}

/**
 * Pendência do Lucas (unificação, 2026-11-22): o que ELE tem que
 * fazer, classificado P1, P2 e P3 pela regra dele de 2026-11-18.
 * Vive no armazenamento interno do painel, como o log. A lista
 * inicial foi migrada da aba Prioridades da central Criação de
 * Conteúdo, lida ao vivo em 2026-11-22: estava vazia (0 itens), e a
 * migração carimba a data em tasksSeededAt sem inventar item nenhum.
 */
export interface PanelTask {
  id: string;
  title: string;
  priority: 1 | 2 | 3;
  project?: string;
  note?: string;
  /** Ticket de suporte: sem solução definitiva, é sempre P3 (regra forçada no servidor). */
  supportTicket: boolean;
  /** Solução definitiva (ferramenta, FAQ ou self-serve): libera o ticket da P3 forçada. */
  definitiveSolution: boolean;
  status: "open" | "done";
  /** ISO da criação; a exibição converte para America/Chicago. */
  createdAt: string;
  completedAt?: string;
  origin: "space-migration" | "panel" | "agent";
  /** Agente do OpenBot que criou a pendência, quando origin = "agent". */
  by?: string;
}

export type SuggestionStatus = "nova" | "aprovada" | "descartada" | "feita";

/**
 * Sugestão de agente PARA UM CLIENTE (pedido do Lucas, 2026-11-26):
 * os agentes do OpenBot (SEO, Social Media, Crescimento, Account
 * Manager...) gravam aqui, pela rota /api/openbot/suggestions, o que
 * deve ser feito para cada cliente: o quê, por quê, o plano completo
 * em markdown e o prompt de execução pronto para o Lucas copiar e
 * colar no agente responsável. A página do cliente no /v2 mostra
 * esta lista como PRIMEIRO bloco. Vive no mesmo documento do painel
 * (panel-state.json), como o log e as pendências. Sugestão sem plano
 * completo e sem prompt é recusada na rota de escrita.
 */
export interface AgentSuggestion {
  id: string;
  /** location_id do HighLevel: a chave que os agentes usam. */
  locationId: string;
  /** Slug do painel, resolvido do location_id na gravação. */
  slug: string;
  /** Agente que sugeriu (ex.: "SEO", "Social Media", "Crescimento"). */
  agent: string;
  /** O que fazer. */
  title: string;
  /** Por que importa. */
  why: string;
  /** O plano completo, em markdown: passos e como fazer. */
  planMd: string;
  /** Prompt de execução pronto para colar no agente responsável. */
  prompt: string;
  status: SuggestionStatus;
  /** ISO da criação; a exibição converte para America/Chicago. */
  createdAt: string;
  updatedAt: string;
}

export const SUGGESTION_STATUSES: SuggestionStatus[] = ["nova", "aprovada", "descartada", "feita"];

/**
 * A regra do Lucas (2026-11-18) numa função só, usada na escrita e
 * na leitura: ticket de suporte sem solução definitiva é P3, sempre.
 */
export function effectivePriority(t: Pick<PanelTask, "priority" | "supportTicket" | "definitiveSolution">): 1 | 2 | 3 {
  if (t.supportTicket && !t.definitiveSolution) return 3;
  return t.priority;
}

export interface PanelState {
  /** Marcações internas de verificado: slug -> ids de contato. */
  verified: Record<string, string[]>;
  /** Histórico: DNDs que a automação de 7 dias (desligada) aplicou em 2026-11-22: slug -> registros. Não cresce mais. */
  dndApplied: Record<string, DndRecord[]>;
  /** Log do painel, do mais antigo ao mais novo (a exibição inverte). */
  log: LogEntry[];
  /** Pendências do Lucas (P1/P2/P3), da mais antiga à mais nova. */
  tasks: PanelTask[];
  /** Sugestões dos agentes por cliente, da mais antiga à mais nova (a exibição inverte). */
  suggestions: AgentSuggestion[];
  /** ISO da migração inicial das pendências (lida da central, vazia, em 2026-11-22). */
  tasksSeededAt?: string;
  /** Nonce da última escrita, gravado no documento pela writeRemote e
   * conferido pela mutateState. PRECISA sobreviver ao normalize: sem
   * ele a conferência nunca casa, a mutateState reaplica a mutação nas
   * 3 tentativas e tudo que é append sai triplicado (bug achado no
   * teste das pendências, 2026-11-22). */
  _nonce?: string;
}

const PANEL_STATE_PATH = "panel-state.json";
const LOG_CAP = 2000;
const SUGGESTION_CAP = 1000;

function emptyState(): PanelState {
  return { verified: {}, dndApplied: {}, log: [], tasks: [], suggestions: [] };
}

function normalizeSuggestion(raw: unknown): AgentSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<AgentSuggestion>;
  if (typeof s.id !== "string" || typeof s.locationId !== "string" || typeof s.title !== "string") return null;
  const status = SUGGESTION_STATUSES.includes(s.status as SuggestionStatus)
    ? (s.status as SuggestionStatus)
    : "nova";
  const createdAt = typeof s.createdAt === "string" ? s.createdAt : new Date(0).toISOString();
  return {
    id: s.id,
    locationId: s.locationId,
    slug: typeof s.slug === "string" ? s.slug : "",
    agent: typeof s.agent === "string" && s.agent ? s.agent.slice(0, 60) : "Agente",
    title: s.title,
    why: typeof s.why === "string" ? s.why : "",
    planMd: typeof s.planMd === "string" ? s.planMd : "",
    prompt: typeof s.prompt === "string" ? s.prompt : "",
    status,
    createdAt,
    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : createdAt,
  };
}

function normalizeTask(raw: unknown): PanelTask | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<PanelTask>;
  if (typeof t.id !== "string" || typeof t.title !== "string") return null;
  const priority = t.priority === 1 || t.priority === 2 || t.priority === 3 ? t.priority : 3;
  return {
    id: t.id,
    title: t.title,
    priority,
    project: typeof t.project === "string" && t.project ? t.project : undefined,
    note: typeof t.note === "string" && t.note ? t.note : undefined,
    supportTicket: t.supportTicket === true,
    definitiveSolution: t.definitiveSolution === true,
    status: t.status === "done" ? "done" : "open",
    createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date(0).toISOString(),
    completedAt: typeof t.completedAt === "string" ? t.completedAt : undefined,
    origin: t.origin === "space-migration" ? "space-migration" : t.origin === "agent" ? "agent" : "panel",
    by: typeof t.by === "string" && t.by ? t.by.slice(0, 60) : undefined,
  };
}

export function stateConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** Tolera o formato antigo do registro de DND (só o id, sem data). */
function normalizeDnd(raw: unknown): DndRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: DndRecord[] = [];
  for (const r of raw) {
    if (typeof r === "string") out.push({ id: r, at: "" });
    else if (r && typeof r === "object" && typeof (r as DndRecord).id === "string") {
      out.push({ id: (r as DndRecord).id, at: typeof (r as DndRecord).at === "string" ? (r as DndRecord).at : "" });
    }
  }
  return out;
}

function normalize(raw: unknown): PanelState {
  const s = emptyState();
  if (raw && typeof raw === "object") {
    const o = raw as Partial<PanelState> & { dndApplied?: Record<string, unknown> };
    if (o.verified && typeof o.verified === "object") {
      for (const [k, v] of Object.entries(o.verified)) {
        if (Array.isArray(v)) s.verified[k] = v.filter((x): x is string => typeof x === "string");
      }
    }
    if (o.dndApplied && typeof o.dndApplied === "object") {
      for (const [k, v] of Object.entries(o.dndApplied)) s.dndApplied[k] = normalizeDnd(v);
    }
    if (Array.isArray(o.log)) {
      s.log = o.log.filter((e): e is LogEntry => Boolean(e) && typeof e === "object" && typeof (e as LogEntry).id === "string");
    }
    if (Array.isArray(o.tasks)) {
      s.tasks = o.tasks.map(normalizeTask).filter((t): t is PanelTask => t !== null);
    }
    if (Array.isArray(o.suggestions)) {
      s.suggestions = o.suggestions.map(normalizeSuggestion).filter((x): x is AgentSuggestion => x !== null);
    }
    if (typeof o.tasksSeededAt === "string") s.tasksSeededAt = o.tasksSeededAt;
    if (typeof o._nonce === "string") s._nonce = o._nonce;
  }
  return s;
}

export function makeTask(partial: Omit<PanelTask, "id" | "createdAt" | "status">): PanelTask {
  return {
    ...partial,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    status: "open",
  };
}

export function makeSuggestion(
  partial: Omit<AgentSuggestion, "id" | "createdAt" | "updatedAt" | "status">,
): AgentSuggestion {
  const now = new Date().toISOString();
  return {
    ...partial,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: now,
    updatedAt: now,
    status: "nova",
  };
}

/** Leitura fresca da store, direto da origem, sem cache de CDN. */
async function readRemote(): Promise<PanelState> {
  if (!stateConfigured()) return emptyState();
  try {
    const res = await get(PANEL_STATE_PATH, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return emptyState();
    const text = await new Response(res.stream).text();
    return normalize(JSON.parse(text));
  } catch {
    return emptyState();
  }
}

async function writeRemote(s: PanelState, nonce: string): Promise<void> {
  const doc = { ...s, _nonce: nonce };
  await put(PANEL_STATE_PATH, JSON.stringify(doc), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

let memCache: { at: number; state: PanelState } | null = null;
const MEM_TTL_MS = 15_000;

/** Estado atual; maxAgeMs 0 força leitura fresca da store. */
export async function getState(maxAgeMs = MEM_TTL_MS): Promise<PanelState> {
  if (memCache && Date.now() - memCache.at < maxAgeMs) return memCache.state;
  const s = await readRemote();
  memCache = { at: Date.now(), state: s };
  return s;
}

/**
 * Lê o documento fresco, aplica a mutação e regrava, CONFERINDO a
 * gravação: relê a origem e, se o nonce da escrita não estiver lá
 * (outra escrita simultânea atropelou), tenta de novo sobre o estado
 * mais novo, até 3 vezes. É o que mantém íntegros os registros quando
 * várias contas gravam ao mesmo tempo.
 */
export async function mutateState(fn: (s: PanelState) => void): Promise<PanelState> {
  let last = await readRemote();
  for (let attempt = 0; attempt < 3; attempt++) {
    const working = normalize(JSON.parse(JSON.stringify(last)));
    fn(working);
    if (working.log.length > LOG_CAP) working.log = working.log.slice(-LOG_CAP);
    if (working.suggestions.length > SUGGESTION_CAP) working.suggestions = working.suggestions.slice(-SUGGESTION_CAP);
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await writeRemote(working, nonce);
    const back = await readRemote();
    memCache = { at: Date.now(), state: back };
    if ((back as PanelState & { _nonce?: string })._nonce === nonce) return back;
    last = back;
  }
  return last;
}

export function makeLogEntry(partial: Omit<LogEntry, "id" | "at">): LogEntry {
  return {
    ...partial,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    at: new Date().toISOString(),
  };
}

/**
 * Acrescenta uma ou mais entradas ao log sem nunca derrubar a ação
 * chamadora: se o armazenamento falhar, a ação (verificação,
 * exclusão) já aconteceu e o erro do log não pode fingir o contrário.
 */
export async function appendLog(entries: LogEntry | LogEntry[]): Promise<void> {
  if (!stateConfigured()) return;
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;
  try {
    await mutateState((s) => { s.log.push(...list); });
  } catch { /* o log nunca derruba a ação */ }
}
