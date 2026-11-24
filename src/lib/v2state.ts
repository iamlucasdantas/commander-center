// Estado PRÓPRIO do Commander Center 2.0 (/v2): as marcas da Action
// queue (Snooze 1 dia e Done). Documento separado no Blob,
// `v2-state.json`, de propósito: a regra de segurança da spec
// (2026-11-24) diz que a versão nova não pode alterar o
// comportamento da atual, e o panel-state.json é da versão atual
// (o normalize dele descartaria campos desconhecidos numa regravada).
// Aqui só vive estado da fila do /v2; nenhuma coleta lê isto.
//
// Regras da fila:
//   - Snooze: some por 24h, aconteça o que acontecer com a métrica.
//   - Done: some enquanto a "assinatura" do item (o valor da métrica
//     quando ele foi concluído) for a mesma; se o número mudar, o
//     item volta sozinho, porque é um problema novo.
import { get, put } from "@vercel/blob";

export interface QueueMark {
  status: "snoozed" | "done";
  at: string; // ISO
  until?: string; // ISO, só no snooze
  signature: string;
}

export interface V2State {
  queue: Record<string, QueueMark>;
  _nonce?: string;
}

const V2_STATE_PATH = "v2-state.json";

function emptyV2State(): V2State {
  return { queue: {} };
}

export function v2StateConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function normalize(raw: unknown): V2State {
  const s = emptyV2State();
  if (raw && typeof raw === "object") {
    const o = raw as Partial<V2State>;
    if (o.queue && typeof o.queue === "object") {
      for (const [k, v] of Object.entries(o.queue)) {
        if (v && typeof v === "object" && (v.status === "snoozed" || v.status === "done")) {
          s.queue[k] = {
            status: v.status,
            at: typeof v.at === "string" ? v.at : "",
            until: typeof v.until === "string" ? v.until : undefined,
            signature: typeof v.signature === "string" ? v.signature : "",
          };
        }
      }
    }
    if (typeof o._nonce === "string") s._nonce = o._nonce;
  }
  return s;
}

async function readRemote(): Promise<V2State> {
  if (!v2StateConfigured()) return emptyV2State();
  try {
    const res = await get(V2_STATE_PATH, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return emptyV2State();
    const text = await new Response(res.stream).text();
    return normalize(JSON.parse(text));
  } catch {
    return emptyV2State();
  }
}

let memCache: { at: number; state: V2State } | null = null;
const MEM_TTL_MS = 15_000;

export async function getV2State(maxAgeMs = MEM_TTL_MS): Promise<V2State> {
  if (memCache && Date.now() - memCache.at < maxAgeMs) return memCache.state;
  const s = await readRemote();
  memCache = { at: Date.now(), state: s };
  return s;
}

/** Mesma disciplina do panel-state: confere o nonce e tenta de novo. */
export async function mutateV2State(fn: (s: V2State) => void): Promise<V2State> {
  let last = await readRemote();
  for (let attempt = 0; attempt < 3; attempt++) {
    const working = normalize(JSON.parse(JSON.stringify(last)));
    fn(working);
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await put(V2_STATE_PATH, JSON.stringify({ ...working, _nonce: nonce }), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    const back = await readRemote();
    memCache = { at: Date.now(), state: back };
    if (back._nonce === nonce) return back;
    last = back;
  }
  return last;
}

/** O item aparece? Aplica as regras de Snooze/Done sobre a fila crua. */
export function queueItemVisible(
  mark: QueueMark | undefined,
  signature: string,
  now = Date.now(),
): boolean {
  if (!mark) return true;
  if (mark.status === "snoozed") {
    return mark.until ? new Date(mark.until).getTime() <= now : true;
  }
  // done: some só enquanto a métrica for a mesma
  return mark.signature !== signature;
}
