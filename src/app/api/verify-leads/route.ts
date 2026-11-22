import { NextResponse } from "next/server";
import { ACCOUNTS } from "@/lib/accounts";
import { verifyAccountLeads } from "@/lib/hl";

// Verificação completa de leads de uma conta (pedido do Lucas em
// 2026-11-22): pagina por TODOS os contatos da location, sem o teto
// de 500 da coleta normal, e devolve a contagem por classe
// (verificado, não verificado, fake e, na Magnetic Funnels US,
// Partner). Só leitura e classificação: nada é excluído nem alterado
// no HighLevel. Desde a correção do Lucas de 2026-11-22 (14:54) NÃO há
// botão de "verificar tudo" na interface: a verificação na tela é
// seletiva, lead a lead, pela rota /api/verify-contact (tag
// "lead-verified"). Esta rota fica como apoio de conferência.
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { slug?: unknown } | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const a = ACCOUNTS.find((x) => x.slug === slug);
  if (!a || !a.locationId || !a.pitEnv) {
    return NextResponse.json({ ok: false, error: "Account has no connected HighLevel location" }, { status: 404 });
  }
  if (!process.env[a.pitEnv]) {
    return NextResponse.json({ ok: false, error: "Account token is not configured" }, { status: 400 });
  }

  try {
    const result = await verifyAccountLeads(a);
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ ok: false, error: "HighLevel collection failed for this account" }, { status: 502 });
  }
}
