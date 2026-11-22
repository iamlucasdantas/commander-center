import { NextResponse } from "next/server";
import { ACCOUNTS } from "@/lib/accounts";

// ROTA TEMPORÁRIA DE SONDA (rodada de personalização, 2026-11-22):
// inspeciona a ESTRUTURA real das respostas do HighLevel para desenhar
// os blocos de serviço (ligações/Voice AI, score da Globalaser, campos
// customizados, endpoints de reputação/funis) a partir de evidência, e
// não de suposição. Devolve só estrutura: tipos, chaves, contagens e
// códigos de status. NENHUM nome, e-mail, telefone ou corpo de
// mensagem sai daqui. Protegida pelo mesmo segredo do coletor.
// REMOVER na mesma rodada em que os blocos forem construídos.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BASE = "https://services.leadconnectorhq.com";

function authorized(req: Request): boolean {
  const secret = process.env.COLLECTOR_SECRET;
  if (!secret) return false;
  return req.headers.get("x-collector-secret") === secret;
}

async function hl(pit: string, path: string): Promise<{ status: number; data: unknown }> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${pit}`, Version: "2021-07-28", Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    let data: unknown = null;
    try { data = await res.json(); } catch { /* sem corpo */ }
    return { status: res.status, data };
  } catch (e) {
    return { status: 0, data: { error: String(e).slice(0, 120) } };
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function keysOf(v: unknown): string[] {
  return isObj(v) ? Object.keys(v) : [];
}

function shortVal(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 60)}…(${v.length})` : v;
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (isObj(v)) return `{${Object.keys(v).slice(0, 10).join(",")}}`;
  return typeof v;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  const a = ACCOUNTS.find((x) => x.slug === slug);
  if (!a?.locationId || !a.pitEnv) {
    return NextResponse.json({ ok: false, error: "account has no location" }, { status: 400 });
  }
  const pit = process.env[a.pitEnv];
  if (!pit) return NextResponse.json({ ok: false, error: "token missing" }, { status: 400 });
  const loc = a.locationId;
  const out: Record<string, unknown> = { slug, locationId: loc };

  // ---- conversas: distribuição de tipos e estrutura das de chamada
  const conv = await hl(pit, `/conversations/search?locationId=${loc}&limit=100`);
  const convList = isObj(conv.data) && Array.isArray(conv.data.conversations) ? conv.data.conversations : [];
  const typeCount: Record<string, number> = {};
  const callConvs: Record<string, unknown>[] = [];
  for (const cv of convList) {
    if (!isObj(cv)) continue;
    const t = `${String(cv.type ?? "")}|${String(cv.lastMessageType ?? "")}`;
    typeCount[t] = (typeCount[t] ?? 0) + 1;
    const isCall = `${cv.type ?? ""} ${cv.lastMessageType ?? ""}`.toUpperCase().includes("CALL");
    if (isCall && callConvs.length < 6) callConvs.push(cv);
  }
  out.conversations = {
    status: conv.status,
    loaded: convList.length,
    total: isObj(conv.data) ? conv.data.total ?? null : null,
    typeCount,
    sampleKeys: convList.length ? keysOf(convList[0]) : [],
    callSample: callConvs.map((cv) => ({
      id: typeof cv.id === "string" ? cv.id : null,
      type: cv.type ?? null,
      lastMessageType: cv.lastMessageType ?? null,
      lastMessageDirection: cv.lastMessageDirection ?? null,
      assignedTo: cv.assignedTo ?? null,
      inboxId: cv.inboxId ?? null,
    })),
  };

  // ---- mensagens das conversas de chamada (estrutura, sem corpo)
  const msgSamples: unknown[] = [];
  for (const cv of callConvs.slice(0, 4)) {
    const id = typeof cv.id === "string" ? cv.id : null;
    if (!id) continue;
    const msgs = await hl(pit, `/conversations/${id}/messages?limit=30`);
    const root = isObj(msgs.data) ? msgs.data : {};
    const inner = isObj(root.messages) ? root.messages : root;
    const list = Array.isArray(inner.messages) ? inner.messages : [];
    msgSamples.push({
      conversationId: id,
      status: msgs.status,
      rootKeys: keysOf(root),
      count: list.length,
      messages: list.slice(0, 12).map((m) => {
        if (!isObj(m)) return { raw: typeof m };
        const meta = isObj(m.meta) ? m.meta : null;
        return {
          keys: keysOf(m),
          type: m.type ?? null,
          direction: m.direction ?? null,
          status: m.status ?? null,
          source: m.source ?? null,
          userId: m.userId ?? null,
          bodyLen: typeof m.body === "string" ? m.body.length : null,
          meta: meta ? Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, shortVal(v)])) : null,
          call: isObj(m.call) ? Object.fromEntries(Object.entries(m.call).map(([k, v]) => [k, shortVal(v)])) : null,
        };
      }),
    });
  }
  out.callMessages = msgSamples;

  // ---- contatos: fontes distintas e estrutura dos campos customizados
  const ct = await hl(pit, `/contacts/?locationId=${loc}&limit=100&page=1`);
  const ctList = isObj(ct.data) && Array.isArray(ct.data.contacts) ? ct.data.contacts : [];
  const sourceCount: Record<string, number> = {};
  const customKeys = new Map<string, { count: number; sampleType: string }>();
  for (const c of ctList) {
    if (!isObj(c)) continue;
    const s = typeof c.source === "string" && c.source ? c.source : "(empty)";
    sourceCount[s] = (sourceCount[s] ?? 0) + 1;
    const cfs = Array.isArray(c.customFields) ? c.customFields : [];
    for (const f of cfs) {
      if (!isObj(f)) continue;
      const key = String(f.fieldKey ?? f.key ?? f.id ?? "?");
      const cur = customKeys.get(key) ?? { count: 0, sampleType: "" };
      cur.count++;
      if (!cur.sampleType) cur.sampleType = typeof f.value;
      customKeys.set(key, cur);
    }
  }
  out.contacts = {
    status: ct.status,
    loaded: ctList.length,
    sourceCount,
    customFields: [...customKeys.entries()].map(([key, v]) => ({ key, ...v })).slice(0, 40),
    sampleKeys: ctList.length ? keysOf(ctList[0]) : [],
  };

  // ---- oportunidades: pipelines, etapas e status
  const pl = await hl(pit, `/opportunities/pipelines?locationId=${loc}`);
  const pipelines = isObj(pl.data) && Array.isArray(pl.data.pipelines) ? pl.data.pipelines : [];
  out.pipelines = {
    status: pl.status,
    list: pipelines.map((p) => {
      if (!isObj(p)) return null;
      const stages = Array.isArray(p.stages) ? p.stages : [];
      return {
        name: p.name ?? null,
        stages: stages.map((s) => (isObj(s) ? s.name ?? null : null)),
      };
    }),
  };

  // ---- endpoints candidatos: reputação, funis, sites (só o status)
  const attempts: Record<string, number> = {};
  const tries: Array<[string, string]> = [
    ["reviews_loc", `/locations/${loc}/reviews`],
    ["reviews_qs", `/reviews/?location_id=${loc}`],
    ["reputation", `/reputation/${loc}`],
    ["funnels", `/funnels/?locationId=${loc}`],
    ["funnels_location", `/funnels/funnel/list?locationId=${loc}`],
  ];
  for (const [name, path] of tries) {
    const r = await hl(pit, path);
    attempts[name] = r.status;
    if (r.status === 200 && name === "funnels") {
      const d = isObj(r.data) ? r.data : {};
      const arr = Array.isArray(d.funnels) ? d.funnels : [];
      out.funnelsSample = arr.slice(0, 5).map((f) => (isObj(f) ? { keys: keysOf(f), name: f.name ?? null } : null));
    }
  }
  out.endpointAttempts = attempts;

  return NextResponse.json({ ok: true, probe: out });
}
