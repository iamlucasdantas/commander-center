import { NextResponse } from "next/server";
import { ACCOUNTS, type Account } from "@/lib/accounts";
import { classifyWithMarks, isStaleUnverified, loadMarks, type HLContact } from "@/lib/hl";
import { appendLog, getState, makeLogEntry, stateConfigured } from "@/lib/state";
import { accountPit, disableContactDnd, isOkStatus, sleep } from "@/lib/hl-write";

// Rota administrativa TEMPORÁRIA (2026-11-22, remover ao fim do uso):
// levantamento e REVERSÃO dos DNDs que a automação de 7 dias aplicou no
// HighLevel antes de ser desligada (correções do Lucas das 15:25 e
// 15:26). O registro interno (state.dndApplied) perdeu escritas na
// primeira rodada (corridas paralelas), então a identificação de quem
// a automação atingiu cruza TRÊS sinais: estar no registro interno, OU
// estar em DND agora com a forma exata da varredura (não verificado +
// velho) e ter sido atualizado dentro da janela de atividade da
// automação (o PUT dela é a última atualização do contato). Quem já
// estava em DND antes da automação tem atualização fora da janela e
// NÃO é tocado.
//
// POST { mode: "report" }            -> contagens por conta (registro + log)
// POST { mode: "diagnose", slug }    -> baldes de evidência de uma conta
// POST { mode: "identify", slug }    -> quantas vítimas, sem escrever nada
// POST { mode: "revert", slug }      -> tira o DND (PUT dnd:false) das
//                                       vítimas daquela conta, um por
//                                       um, e grava a reversão no log.
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

interface RawContact extends HLContact {
  dateUpdated?: string;
}

/** Pagina TODOS os contatos da location (cru, com dateUpdated). */
async function fetchAllRaw(a: Account, pit: string): Promise<RawContact[]> {
  const out: RawContact[] = [];
  for (let page = 1; page <= 60; page++) {
    const res = await fetch(`${BASE}/contacts/?locationId=${a.locationId}&limit=100&page=${page}`, {
      headers: { Authorization: `Bearer ${pit}`, Version: "2021-07-28", Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) break;
    const data = (await res.json()) as { contacts?: RawContact[]; meta?: { nextPage?: number | null } };
    const batch = data.contacts ?? [];
    out.push(...batch);
    if (!data.meta?.nextPage || batch.length === 0) break;
  }
  return out;
}

/** Nomes citados nos detalhes das entradas "dnd-automation" do log da conta. */
function logDetailNames(log: { slug: string; action: string; detail?: string }[], slug: string): Set<string> {
  const names = new Set<string>();
  for (const e of log) {
    if (e.slug !== slug || e.action !== "dnd-automation" || !e.detail) continue;
    for (const part of e.detail.split(", ")) {
      const n = part.trim().toLowerCase();
      if (n) names.add(n);
    }
  }
  return names;
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

  if (mode === "diagnose") {
    const a: Account | undefined = ACCOUNTS.find((x) => x.slug === body.slug);
    if (!a || a.sourceStatus !== "hl-location") {
      return NextResponse.json({ ok: false, error: "Unknown or unconnected account slug" }, { status: 400 });
    }
    let pit: string;
    try {
      pit = accountPit(a);
    } catch {
      return NextResponse.json({ ok: false, error: "Account token is not configured" }, { status: 500 });
    }
    const records = state.dndApplied[a.slug] ?? [];
    const regIds = new Set(records.map((r) => r.id));
    const ats = records.map((r) => r.at).filter(Boolean).sort();
    const names = logDetailNames(state.log, a.slug);
    const all = await fetchAllRaw(a, pit);
    const now = Date.now();
    const windowStart = ats.length
      ? new Date(ats[0]).getTime() - 30 * 60_000
      : new Date("2026-11-22T00:00:00Z").getTime();
    const dndTrue = all.filter((c) => c.dnd === true);
    const marks0 = await loadMarks(a);
    const isVictimShape = (c: RawContact) => classifyWithMarks(a, c, marks0) === "unverified" && isStaleUnverified(c, now);
    let inRegistry = 0;
    let bNameAndWindow = 0;
    let cWindowOnly = 0;
    let dOutside = 0;
    let cVictimShape = 0;
    let dVictimShape = 0;
    const cSamples: { id: string; name: string; dateUpdated?: string }[] = [];
    const dSamples: { id: string; name: string; dateUpdated?: string }[] = [];
    for (const c of dndTrue) {
      if (regIds.has(c.id)) { inRegistry++; continue; }
      const upd = c.dateUpdated ? new Date(c.dateUpdated).getTime() : 0;
      const inWindow = upd >= windowStart;
      const nm = displayName(c, c.id).toLowerCase();
      if (inWindow && names.has(nm)) bNameAndWindow++;
      else if (inWindow) {
        cWindowOnly++;
        if (isVictimShape(c)) cVictimShape++;
        if (cSamples.length < 8) cSamples.push({ id: c.id, name: displayName(c, c.id), dateUpdated: c.dateUpdated });
      } else {
        dOutside++;
        if (isVictimShape(c)) dVictimShape++;
        if (dSamples.length < 8) dSamples.push({ id: c.id, name: displayName(c, c.id), dateUpdated: c.dateUpdated });
      }
    }
    return NextResponse.json({
      ok: true,
      mode,
      slug: a.slug,
      name: a.name,
      totalContacts: all.length,
      dndTrue: dndTrue.length,
      registeredByAutomation: records.length,
      logApplied: logApplied.get(a.slug) ?? 0,
      registryAtMin: ats[0] ?? null,
      registryAtMax: ats[ats.length - 1] ?? null,
      windowStart: new Date(windowStart).toISOString(),
      buckets: {
        inRegistry,
        notReg_window_and_nameInLog: bNameAndWindow,
        notReg_window_only: cWindowOnly,
        notReg_window_only_victimShape: cVictimShape,
        notReg_outsideWindow: dOutside,
        notReg_outsideWindow_victimShape: dVictimShape,
      },
      cSamples,
      dSamples,
    });
  }

  if (mode === "identify" || mode === "revert") {
    const a: Account | undefined = ACCOUNTS.find((x) => x.slug === body.slug);
    if (!a || a.sourceStatus !== "hl-location") {
      return NextResponse.json({ ok: false, error: "Unknown or unconnected account slug" }, { status: 400 });
    }
    let pit: string;
    try {
      pit = accountPit(a);
    } catch {
      return NextResponse.json({ ok: false, error: "Account token is not configured" }, { status: 500 });
    }
    const records = state.dndApplied[a.slug] ?? [];
    const regIds = new Set(records.map((r) => r.id));
    // Janela de atividade da automação: da primeira entrada de log
    // "dnd-automation" (menos 10 min de margem) até o deploy que a
    // desligou (2026-11-22T21:32Z). Fora dessa janela, DND é anterior
    // à automação e NÃO é tocado.
    const autoAts = state.log.filter((e) => e.action === "dnd-automation").map((e) => new Date(e.at).getTime()).filter((t) => t > 0);
    const windowStart = (autoAts.length ? Math.min(...autoAts) : new Date("2026-11-22T00:00:00Z").getTime()) - 10 * 60_000;
    const windowEnd = new Date("2026-11-22T21:32:00Z").getTime();
    const marks = await loadMarks(a);
    const now = Date.now();
    const all = await fetchAllRaw(a, pit);
    // Vítima da automação: está em DND agora, tem a forma exata que a
    // varredura mirava (não verificado pela regra completa + velho) e
    // OU está no registro interno OU foi atualizado dentro da janela
    // de atividade da automação (o PUT dela é a última atualização).
    const victims = all.filter((c) => {
      if (c.dnd !== true) return false;
      if (classifyWithMarks(a, c, marks) !== "unverified" || !isStaleUnverified(c, now)) return false;
      if (regIds.has(c.id)) return true;
      const upd = c.dateUpdated ? new Date(c.dateUpdated).getTime() : 0;
      return upd >= windowStart && upd <= windowEnd;
    });
    const fromRegistry = victims.filter((c) => regIds.has(c.id)).length;
    const identified = {
      slug: a.slug,
      name: a.name,
      registered: records.length,
      identifiedVictims: victims.length,
      fromRegistry,
      fromWindow: victims.length - fromRegistry,
      windowStart: new Date(windowStart).toISOString(),
      windowEnd: new Date(windowEnd).toISOString(),
    };
    if (mode === "identify") {
      return NextResponse.json({ ok: true, mode, ...identified });
    }

    const reverted: { id: string; name: string }[] = [];
    const failed: { id: string; name: string; status: number }[] = [];
    for (const c of victims) {
      const name = displayName(c, c.id);
      try {
        const r = await disableContactDnd(pit, c.id);
        if (isOkStatus(r.status)) reverted.push({ id: c.id, name });
        else failed.push({ id: c.id, name, status: r.status });
      } catch {
        failed.push({ id: c.id, name, status: 0 });
      }
      if (victims.length > 1) await sleep(150);
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
      ...identified,
      reverted: reverted.length,
      failed,
      sample,
    });
  }

  return NextResponse.json({ ok: false, error: "Unknown mode" }, { status: 400 });
}
