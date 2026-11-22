import { NextResponse } from "next/server";
import { ACCOUNTS } from "@/lib/accounts";
import { LEAD_VERIFIED_TAG } from "@/lib/hl";
import { accountPit, addContactTags, isOkStatus, isPermissionError, sleep } from "@/lib/hl-write";

// Verificação manual e SELETIVA de leads (correção do Lucas, 2026-11-22
// 14:54: "Não quero verificar todos, quero poder selecionar ou fazer
// individualmente"). A página da conta manda o slug e os ids marcados
// (um lead ou a seleção); para cada contato, aplica a tag
// "lead-verified" no HighLevel (POST /contacts/{id}/tags, escopo
// contacts.write). A classificação do painel trata contato com essa
// tag como VERIFICADO em tudo (listas, filtros, conversas não lidas,
// contadores) e ele nunca entra no conjunto de excluíveis.
// Falha de permissão NÃO é disfarçada: volta como erro para a tela.
export const maxDuration = 60;

const DELAY_MS = 150;
const MAX_IDS = 200;

interface ItemResult {
  id: string;
  ok: boolean;
  error?: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { slug?: unknown; ids?: unknown } | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const rawIds = Array.isArray(body?.ids) ? body.ids : [];
  const ids = [...new Set(rawIds.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, MAX_IDS);

  const a = ACCOUNTS.find((x) => x.slug === slug);
  if (!a || !a.locationId || !a.pitEnv) {
    return NextResponse.json({ ok: false, error: "Account has no connected HighLevel location" }, { status: 404 });
  }
  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: "No leads selected" }, { status: 400 });
  }

  let pit: string;
  try {
    pit = accountPit(a);
  } catch {
    return NextResponse.json({ ok: false, error: "Account token is not configured" }, { status: 400 });
  }

  const results: ItemResult[] = [];
  let permissionDenied = false;
  for (const id of ids) {
    try {
      const r = await addContactTags(pit, id, [LEAD_VERIFIED_TAG]);
      if (isOkStatus(r.status)) {
        results.push({ id, ok: true });
      } else if (isPermissionError(r.status)) {
        permissionDenied = true;
        results.push({ id, ok: false, error: "no permission" });
      } else {
        results.push({ id, ok: false, error: `HighLevel answered ${r.status}` });
      }
    } catch {
      results.push({ id, ok: false, error: "network error" });
    }
    if (ids.length > 1) await sleep(DELAY_MS);
  }

  const verifiedCount = results.filter((r) => r.ok).length;
  const failedCount = results.length - verifiedCount;
  if (verifiedCount === 0 && permissionDenied) {
    return NextResponse.json(
      {
        ok: false,
        error: "This account's key has no write permission yet, so the lead-verified tag could not be applied",
        results,
        verifiedCount,
        failedCount,
      },
      { status: 403 },
    );
  }

  return NextResponse.json({
    ok: verifiedCount > 0,
    slug: a.slug,
    tag: LEAD_VERIFIED_TAG,
    results,
    verifiedCount,
    failedCount,
    ...(permissionDenied && failedCount > 0
      ? { error: "Some leads could not be verified: the account key has no write permission" }
      : {}),
  });
}
