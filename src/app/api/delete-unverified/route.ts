import { NextResponse } from "next/server";
import { ACCOUNTS } from "@/lib/accounts";
import { contactRecord, fetchContactsLive, loadMarks, unverifiedWeekContacts, type ContactRecord, type HLContact } from "@/lib/hl";
import { accountPit, deleteContact, isOkStatus, isPermissionError, sleep } from "@/lib/hl-write";
import { appendLog, makeLogEntry } from "@/lib/state";

// Exclusão em massa dos leads NÃO VERIFICADOS de uma conta, direto no
// HighLevel (decisão do Lucas, 2026-11-22). Dois modos:
//   prepare -> dry run: classifica os contatos frescos e devolve a
//              contagem exata + o registro completo do que seria
//              excluído. Nada é apagado neste modo.
//   execute -> apaga SOMENTE os ids enviados que continuarem
//              classificados como não verificados numa leitura fresca.
//              O registro do que foi excluído volta na resposta e a
//              interface o baixa como arquivo antes de mostrar o
//              resultado: sem registro, não há exclusão.
// Escopo da ação: não verificados dos últimos 7 dias, exatamente o
// conjunto que o filtro "Unverified" da página da conta mostra. Fakes
// (quarentena) e verificados nunca entram. Contatos do Partner Plan
// também nunca entram: exclusão dura em unverifiedWeekContacts (hl.ts),
// porque quem passou pelo Partner continua no sistema (regra do Lucas).
export const maxDuration = 60;

const MAX_BATCH = 200;
const DELAY_MS = 150; // ritmo conservador entre exclusões

interface DeleteRecord {
  account: string;
  slug: string;
  scope: string;
  generatedAt: string;
  contacts: ContactRecord[];
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { slug?: unknown; mode?: unknown; ids?: unknown }
    | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const mode = body?.mode === "execute" ? "execute" : "prepare";
  const a = ACCOUNTS.find((x) => x.slug === slug);
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

  const now = Date.now();
  const marks = await loadMarks(a);
  const eligible = unverifiedWeekContacts(contacts, now, marks.verifiedIds);
  const record: DeleteRecord = {
    account: a.name,
    slug: a.slug,
    scope: "Unverified contacts from the last 7 days (stray email origin, same set as the Unverified filter)",
    generatedAt: new Date(now).toISOString(),
    contacts: [],
  };

  if (mode === "prepare") {
    record.contacts = eligible.map(contactRecord);
    return NextResponse.json({ ok: true, mode, slug: a.slug, account: a.name, count: eligible.length, record });
  }

  // execute
  const rawIds = Array.isArray(body?.ids) ? body.ids : [];
  const ids = rawIds.filter((x): x is string => typeof x === "string").slice(0, MAX_BATCH);
  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: "No contact ids to delete" }, { status: 400 });
  }

  const eligibleById = new Map(eligible.map((c) => [c.id, c]));
  const targets = ids.filter((id) => eligibleById.has(id)).map((id) => eligibleById.get(id)!);
  const skipped = ids.filter((id) => !eligibleById.has(id));
  record.contacts = targets.map(contactRecord);

  const deleted: ContactRecord[] = [];
  const failed: Array<{ id: string; name: string; status: number }> = [];
  for (const c of targets) {
    let status: number;
    try {
      status = await deleteContact(pit, c.id);
    } catch {
      status = 0;
    }
    if (isPermissionError(status)) {
      // Sem o escopo de exclusão na chave, para tudo e diz a verdade.
      if (deleted.length > 0) {
        await appendLog([
          makeLogEntry({
            slug: a.slug,
            account: a.name,
            action: "delete-unverified",
            kind: "log",
            status: "completed",
            title: `Deleted ${deleted.length} unverified contact${deleted.length === 1 ? "" : "s"} in HighLevel (stopped: no delete permission)`,
            detail: `Record ${record.generatedAt} · ${deleted.map((d) => d.name).join(", ")}`.slice(0, 4000),
          }),
        ]);
      }
      return NextResponse.json(
        {
          ok: false,
          error: "no_delete_permission",
          message: "This account's key has no delete permission yet",
          deletedCount: deleted.length,
          deleted,
          record,
        },
        { status: 403 },
      );
    }
    if (isOkStatus(status)) deleted.push(contactRecord(c));
    else failed.push({ id: c.id, name: contactRecord(c).name, status });
    if (DELAY_MS) await sleep(DELAY_MS);
  }

  if (deleted.length > 0) {
    await appendLog([
      makeLogEntry({
        slug: a.slug,
        account: a.name,
        action: "delete-unverified",
        kind: "log",
        status: "completed",
        title: `Deleted ${deleted.length} unverified contact${deleted.length === 1 ? "" : "s"} in HighLevel`,
        detail: `Record ${record.generatedAt} · ${deleted.map((d) => d.name).join(", ")}`.slice(0, 4000),
      }),
    ]);
  }

  return NextResponse.json({
    ok: true,
    mode,
    slug: a.slug,
    account: a.name,
    deletedCount: deleted.length,
    failedCount: failed.length,
    failed,
    skipped,
    record,
  });
}
