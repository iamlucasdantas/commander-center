import { NextResponse } from "next/server";
import { ACCOUNTS } from "@/lib/accounts";
import {
  PARTNER_ACCOUNT_SLUG,
  PARTNER_SEPARATED_TAG,
  contactRecord,
  fetchContactsLive,
  partnerBuyerContacts,
  type HLContact,
} from "@/lib/hl";
import { accountPit, addContactTags, enableContactDnd, isOkStatus, isPermissionError, sleep } from "@/lib/hl-write";
import { appendLog, makeLogEntry } from "@/lib/state";

// Separação dos compradores Partner US$ 1 dentro do HighLevel (regra do
// Lucas, 2026-11-22): eles ficam numa lista separada e fora do alcance
// das campanhas da conta Magnetic Funnels (US). Para cada contato do
// grupo (marcador: source do Partner Plan, ver hl.ts):
//   1. liga o DND do contato (PUT /contacts/{id} com dnd: true);
//   2. adiciona a tag "partner-usd1" (POST /contacts/{id}/tags).
// Dois modos, como a exclusão: prepare (contagem, nada muda) e execute
// (aplica, contato a contato, reportando sucesso e falha de cada um).
// Só vale para a conta Magnetic Funnels (US).
export const maxDuration = 60;

const DELAY_MS = 150;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { slug?: unknown; mode?: unknown; ids?: unknown; limit?: unknown }
    | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const mode = body?.mode === "execute" ? "execute" : "prepare";

  if (slug !== PARTNER_ACCOUNT_SLUG) {
    return NextResponse.json(
      { ok: false, error: "This action only applies to Magnetic Funnels (US)" },
      { status: 400 },
    );
  }
  const a = ACCOUNTS.find((x) => x.slug === PARTNER_ACCOUNT_SLUG);
  if (!a || !a.locationId || !a.pitEnv) {
    return NextResponse.json({ ok: false, error: "Account has no connected HighLevel location" }, { status: 404 });
  }

  let pit: string;
  try {
    pit = accountPit(a);
  } catch {
    return NextResponse.json({ ok: false, error: "Account token is not configured" }, { status: 400 });
  }

  let contacts: HLContact[];
  try {
    contacts = await fetchContactsLive(a);
  } catch {
    return NextResponse.json({ ok: false, error: "HighLevel collection failed for this account" }, { status: 502 });
  }

  const all = partnerBuyerContacts(a, contacts);
  const separated = all.filter((c) => (c.tags ?? []).includes(PARTNER_SEPARATED_TAG));
  const pending = all.filter((c) => !(c.tags ?? []).includes(PARTNER_SEPARATED_TAG));

  if (mode === "prepare") {
    return NextResponse.json({
      ok: true,
      mode,
      slug: a.slug,
      account: a.name,
      total: all.length,
      separatedCount: separated.length,
      pendingCount: pending.length,
      pending: pending.map(contactRecord),
    });
  }

  // execute
  const rawIds = Array.isArray(body?.ids) ? body.ids : null;
  const limit = typeof body?.limit === "number" && body.limit > 0 ? Math.floor(body.limit) : null;
  let targets = pending;
  if (rawIds) {
    const wanted = new Set(rawIds.filter((x): x is string => typeof x === "string"));
    targets = pending.filter((c) => wanted.has(c.id));
  }
  if (limit) targets = targets.slice(0, limit);
  if (targets.length === 0) {
    return NextResponse.json({ ok: false, error: "No pending Partner contacts to separate" }, { status: 400 });
  }

  const results: Array<{
    id: string;
    name: string;
    dnd: boolean;
    tag: boolean;
    status?: number;
    dndConfirmed?: boolean | null;
  }> = [];

  for (const c of targets) {
    const rec = contactRecord(c);
    let dndOk = false;
    let tagOk = false;
    let lastStatus = 0;
    let dndConfirmed: boolean | null = null;
    try {
      const dndRes = await enableContactDnd(pit, c.id);
      lastStatus = dndRes.status;
      if (isPermissionError(dndRes.status)) {
        return NextResponse.json(
          {
            ok: false,
            error: "no_write_permission",
            message: "This account's key has no write permission yet",
            results,
          },
          { status: 403 },
        );
      }
      dndOk = isOkStatus(dndRes.status);
      const d = dndRes.data as { contact?: { dnd?: unknown }; dnd?: unknown } | null;
      const raw = d?.contact?.dnd ?? d?.dnd;
      dndConfirmed = typeof raw === "boolean" ? raw : null;
    } catch { /* dndOk fica false e o status 0 registra a falha de rede */ }

    if (dndOk) {
      try {
        const tagRes = await addContactTags(pit, c.id, [PARTNER_SEPARATED_TAG]);
        lastStatus = tagRes.status;
        if (isPermissionError(tagRes.status)) {
          return NextResponse.json(
            {
              ok: false,
              error: "no_write_permission",
              message: "This account's key has no write permission yet",
              results,
            },
            { status: 403 },
          );
        }
        tagOk = isOkStatus(tagRes.status);
      } catch { /* idem */ }
    }

    results.push({ id: c.id, name: rec.name, dnd: dndOk, tag: tagOk, status: lastStatus, dndConfirmed });
    if (DELAY_MS) await sleep(DELAY_MS);
  }

  const done = results.filter((r) => r.dnd && r.tag).length;
  if (done > 0) {
    await appendLog([
      makeLogEntry({
        slug: a.slug,
        account: a.name,
        action: "partner-separate",
        kind: "log",
        status: "completed",
        title: `Partner separation: ${done} contact${done === 1 ? "" : "s"} separated in HighLevel (DND on, partner-usd1 tag)`,
        detail: results.filter((r) => r.dnd && r.tag).map((r) => r.name).join(", ").slice(0, 4000),
      }),
    ]);
  }
  return NextResponse.json({
    ok: true,
    mode,
    slug: a.slug,
    account: a.name,
    processed: results.length,
    separatedCount: done,
    failedCount: results.length - done,
    results,
  });
}
