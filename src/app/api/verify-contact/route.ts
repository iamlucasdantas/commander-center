import { NextResponse } from "next/server";
import { ACCOUNTS } from "@/lib/accounts";
import { makeLogEntry, mutateState, stateConfigured } from "@/lib/state";

// Verificação manual e SELETIVA de leads (correções do Lucas,
// 2026-11-22 14:54 e 15:02): ele seleciona os leads (ou verifica um por
// vez) e a marcação é INTERNA do painel. NADA é escrito no HighLevel
// por esta rota: nada de tag, nada de DND, nada. Os ids marcados ficam
// no armazenamento interno (state.ts, Blob privada do projeto) e a
// classificação do painel (classifyWithMarks) passa a tratar esses
// contatos como VERIFICADOS em tudo: listas, filtros, conversas não
// lidas e contadores, e eles nunca entram no conjunto de excluíveis.
// Cada verificação gera uma entrada no LOG do painel (quem, quantos e
// quais leads).
export const maxDuration = 60;

const MAX_ITEMS = 200;

interface Item {
  id: string;
  name: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { slug?: unknown; items?: unknown; ids?: unknown }
    | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";

  const items: Item[] = [];
  if (Array.isArray(body?.items)) {
    for (const raw of body.items) {
      const it = raw as { id?: unknown; name?: unknown };
      if (typeof it?.id === "string" && it.id) {
        items.push({ id: it.id, name: typeof it.name === "string" && it.name ? it.name : it.id });
      }
    }
  } else if (Array.isArray(body?.ids)) {
    for (const id of body.ids) {
      if (typeof id === "string" && id) items.push({ id, name: id });
    }
  }
  const unique = [...new Map(items.map((i) => [i.id, i])).values()].slice(0, MAX_ITEMS);

  const a = ACCOUNTS.find((x) => x.slug === slug);
  if (!a || !a.locationId) {
    return NextResponse.json({ ok: false, error: "Account has no connected HighLevel location" }, { status: 404 });
  }
  if (unique.length === 0) {
    return NextResponse.json({ ok: false, error: "No leads selected" }, { status: 400 });
  }
  if (!stateConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Internal storage is not configured yet, so the verification cannot be saved" },
      { status: 503 },
    );
  }

  try {
    await mutateState((s) => {
      const cur = new Set(s.verified[a.slug] ?? []);
      for (const it of unique) cur.add(it.id);
      s.verified[a.slug] = [...cur];
      s.log.push(
        makeLogEntry({
          slug: a.slug,
          account: a.name,
          action: "manual-verify",
          kind: "log",
          status: "completed",
          title: `Manual verification: ${unique.length} lead${unique.length === 1 ? "" : "s"} marked as verified`,
          detail: unique.map((i) => i.name).join(", ").slice(0, 4000),
        }),
      );
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "The internal storage did not answer, so nothing was marked" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    slug: a.slug,
    verifiedCount: unique.length,
    results: unique.map((i) => ({ id: i.id, ok: true })),
    failedCount: 0,
  });
}
