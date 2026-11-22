import { NextResponse } from "next/server";
import { ACCOUNTS, type Account } from "@/lib/accounts";
import { fetchContactsLive, type HLContact } from "@/lib/hl";
import { appendLog, getState, makeLogEntry, stateConfigured } from "@/lib/state";
import { accountPit, disableContactDnd, isOkStatus, sleep } from "@/lib/hl-write";

// Rota administrativa TEMPORÁRIA (2026-11-22, remover ao fim do uso):
// levantamento e REVERSÃO dos DNDs que a automação de 7 dias aplicou no
// HighLevel antes de ser desligada (correções do Lucas das 15:25 e
// 15:26). A fonte de verdade de QUEM a automação atingiu é o registro
// interno (state.dndApplied) cruzado com o log do painel: só ids que
// estão nesse registro são revertidos. Quem já estava em DND antes da
// automação NÃO está no registro e não é tocado.
//
// POST { mode: "report" }          -> contagens por conta (registro + log)
// POST { mode: "revert", slug }    -> tira o DND (PUT dnd:false) dos ids
//                                     registrados daquela conta, um por
//                                     um, e grava a reversão no log.
export const maxDuration = 300;

const BASE = "https://services.leadconnectorhq.com";

function displayName(c: HLContact | undefined, id: string): string {
  if (!c) return id;
  return c.contactName || c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || id;
}

function logAppliedBySlug(log: { slug: string; action: string; title: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of log) {
    if (e.action !== "dnd-automation") continue;
    const m = /(\d+)\s+contact/.exec(e.title);
    const n = m ? parseInt(m[1], 10) : 0;
    out.set(e.slug, (out.get(e.slug) ?? 0) + n);
  }
  return out;
}

async function getContactDnd(pit: string, contactId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${BASE}/contacts/${contactId}`, {
      headers: { Authorization: `Bearer ${pit}`, Version: "2021-07-28", Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { contact?: { dnd?: unknown }; dnd?: unknown };
    const raw = data?.contact?.dnd ?? data?.dnd;
    return typeof raw === "boolean" ? raw : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!stateConfigured()) {
    return NextResponse.json({ ok: false, error: "Panel state storage is not configured" }, { status: 500 });
  }
  let body: { mode?: string; slug?: string } = {};
  try {
    body = (await req.json()) as { mode?: string; slug?: string };
  } catch { /* corpo vazio cai no report */ }
  const mode = body.mode ?? "report";
  const state = await getState(0);
  const logApplied = logAppliedBySlug(state.log);

  if (mode === "report") {
    const accounts = ACCOUNTS.filter((a) => a.sourceStatus === "hl-location").map((a) => {
      const records = state.dndApplied[a.slug] ?? [];
      return {
        slug: a.slug,
        name: a.name,
        registeredByAutomation: records.length,
        logApplied: logApplied.get(a.slug) ?? 0,
        ids: records.map((r) => r.id),
      };
    });
    return NextResponse.json({
      ok: true,
      mode,
      totalRegistered: accounts.reduce((n, a) => n + a.registeredByAutomation, 0),
      totalLogApplied: accounts.reduce((n, a) => n + a.logApplied, 0),
      accounts,
    });
  }

  if (mode === "revert") {
    const a: Account | undefined = ACCOUNTS.find((x) => x.slug === body.slug);
    if (!a || a.sourceStatus !== "hl-location") {
      return NextResponse.json({ ok: false, error: "Unknown or unconnected account slug" }, { status: 400 });
    }
    const records = state.dndApplied[a.slug] ?? [];
    if (records.length === 0) {
      return NextResponse.json({ ok: true, mode, slug: a.slug, registered: 0, reverted: 0, failed: [], sample: [] });
    }
    let pit: string;
    try {
      pit = accountPit(a);
    } catch {
      return NextResponse.json({ ok: false, error: "Account token is not configured" }, { status: 500 });
    }
    let byId = new Map<string, HLContact>();
    try {
      const contacts = await fetchContactsLive(a);
      byId = new Map(contacts.map((c) => [c.id, c]));
    } catch { /* sem nomes, a reversão segue pelos ids */ }

    const reverted: { id: string; name: string }[] = [];
    const failed: { id: string; name: string; status: number }[] = [];
    for (const rec of records) {
      const name = displayName(byId.get(rec.id), rec.id);
      try {
        const r = await disableContactDnd(pit, rec.id);
        if (isOkStatus(r.status)) reverted.push({ id: rec.id, name });
        else failed.push({ id: rec.id, name, status: r.status });
      } catch {
        failed.push({ id: rec.id, name, status: 0 });
      }
      if (records.length > 1) await sleep(150);
    }

    // Amostra: confere no HighLevel até 3 dos revertidos com dnd desligado.
    const sample: { id: string; name: string; dnd: boolean | null }[] = [];
    for (const r of reverted.slice(0, 3)) {
      sample.push({ id: r.id, name: r.name, dnd: await getContactDnd(pit, r.id) });
    }

    if (reverted.length > 0 || failed.length > 0) {
      const failDetail = failed.length > 0
        ? ` Failed: ${failed.map((f) => `${f.name} (${f.id}, HTTP ${f.status})`).join(", ")}.`
        : "";
      await appendLog(makeLogEntry({
        slug: a.slug,
        account: a.name,
        action: "dnd-revert",
        kind: "log",
        status: "completed",
        title: `DND reversal: ${reverted.length} contact${reverted.length === 1 ? "" : "s"} taken off DND (Nov 22 automation, reverted on Lucas's order)`,
        detail: (reverted.map((r) => r.name).join(", ") + failDetail).slice(0, 4000),
      }));
    }

    return NextResponse.json({
      ok: true,
      mode,
      slug: a.slug,
      name: a.name,
      registered: records.length,
      reverted: reverted.length,
      failed,
      sample,
    });
  }

  return NextResponse.json({ ok: false, error: "Unknown mode" }, { status: 400 });
}
