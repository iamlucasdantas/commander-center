// Ações de escrita no HighLevel (API v2) usando o PIT de cada location.
// Só as rotas de ação sob demanda usam isto (excluir não verificados e
// separar compradores Partner). A leitura do painel continua em hl.ts.
//
// Os PITs foram criados originalmente só com escopos de leitura; a escrita
// exige o escopo de contatos (contacts.write) na integração privada. Sem
// ele, a API responde 401/403 e as rotas traduzem isso para a mensagem
// "This account's key has no delete/write permission yet", sem fingir
// sucesso.
import type { Account } from "./accounts";

const BASE = "https://services.leadconnectorhq.com";

export function accountPit(a: Account): string {
  if (!a.pitEnv) throw new Error("Account has no credential variable");
  const pit = process.env[a.pitEnv];
  if (!pit) throw new Error("Account token is not configured");
  return pit;
}

export function isPermissionError(status: number): boolean {
  return status === 401 || status === 403;
}

export function isOkStatus(status: number): boolean {
  return status === 200 || status === 201 || status === 204;
}

interface HLWriteResult {
  status: number;
  data: unknown;
}

async function hlWrite(pit: string, method: string, path: string, body?: unknown): Promise<HLWriteResult> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${pit}`,
      Version: "2021-07-28",
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(9000),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch { /* corpo vazio ou não-JSON */ }
  return { status: res.status, data };
}

/** DELETE /contacts/{id}: apaga o contato na location. Devolve o status HTTP. */
export async function deleteContact(pit: string, contactId: string): Promise<number> {
  const r = await hlWrite(pit, "DELETE", `/contacts/${contactId}`);
  return r.status;
}

/**
 * Liga o DND do contato: PUT /contacts/{id} com o campo `dnd: true`,
 * que é o campo booleano documentado do objeto de contato na API v2.
 */
export async function enableContactDnd(pit: string, contactId: string): Promise<HLWriteResult> {
  return hlWrite(pit, "PUT", `/contacts/${contactId}`, { dnd: true });
}

/**
 * Desliga o DND do contato: PUT /contacts/{id} com `dnd: false`.
 * Usado SÓ pela reversão pontual dos DNDs que a automação de 7 dias
 * (desligada em 2026-11-22) aplicou, por ordem expressa do Lucas.
 */
export async function disableContactDnd(pit: string, contactId: string): Promise<HLWriteResult> {
  return hlWrite(pit, "PUT", `/contacts/${contactId}`, { dnd: false });
}

/** Adiciona tags ao contato: POST /contacts/{id}/tags com { tags: [...] }. */
export async function addContactTags(pit: string, contactId: string, tags: string[]): Promise<HLWriteResult> {
  return hlWrite(pit, "POST", `/contacts/${contactId}/tags`, { tags });
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
