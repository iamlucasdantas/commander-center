import { NextResponse } from "next/server";
import { ACCOUNTS } from "@/lib/accounts";
import { getState, makeLogEntry, mutateState, stateConfigured } from "@/lib/state";

// LOG do painel (pedido do Lucas, 2026-11-22 15:03): registro interno
// de tudo que acontece no Commander Center, no mesmo armazenamento
// das marcações de verificado (state.ts, Blob privada do projeto).
//   GET  /api/log            -> todas as entradas (mais novas primeiro)
//   GET  /api/log?slug=xxx   -> só as entradas daquela conta
//   POST /api/log            -> entrada manual do Lucas na página da
//        conta: { slug, title, kind: "log"|"task", status:
//        "pending"|"completed", detail? } com data automática.
// As entradas automáticas (verificação manual, automação DND, exclusão,
// separação Partner) são gravadas pelas próprias rotas de ação via
// state.ts, não por esta rota. Nada aqui escreve no HighLevel.
export const maxDuration = 60;

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("slug");
  if (!stateConfigured()) {
    return NextResponse.json({ ok: true, entries: [], configured: false });
  }
  const s = await getState(0);
  const entries = [...s.log]
    .filter((e) => !slug || e.slug === slug)
    .sort((x, y) => (x.at < y.at ? 1 : -1));
  return NextResponse.json({ ok: true, entries, configured: true });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { slug?: unknown; title?: unknown; kind?: unknown; status?: unknown; detail?: unknown }
    | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const kind = body?.kind === "task" ? "task" : "log";
  const status = body?.status === "pending" ? "pending" : "completed";
  const detail = typeof body?.detail === "string" && body.detail.trim() ? body.detail.trim().slice(0, 4000) : undefined;
  const byRaw = (body as { by?: unknown } | null)?.by;
  const by = typeof byRaw === "string" && byRaw.trim() ? byRaw.trim().slice(0, 60) : undefined;

  const a = ACCOUNTS.find((x) => x.slug === slug);
  if (!a) {
    return NextResponse.json({ ok: false, error: "Unknown account" }, { status: 404 });
  }
  if (!title) {
    return NextResponse.json({ ok: false, error: "Title is required" }, { status: 400 });
  }
  if (!stateConfigured()) {
    return NextResponse.json({ ok: false, error: "Internal storage is not configured yet" }, { status: 503 });
  }

  const entry = makeLogEntry({
    slug: a.slug,
    account: a.name,
    action: by ? "agent" : "manual",
    by,
    kind,
    status,
    title: title.slice(0, 300),
    detail: by ? `by ${by}${detail ? ` · ${detail}` : ""}` : detail,
  });
  try {
    await mutateState((s) => {
      s.log.push(entry);
    });
  } catch {
    return NextResponse.json({ ok: false, error: "The internal storage did not answer" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, entry });
}
