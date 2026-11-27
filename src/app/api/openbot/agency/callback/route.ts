import { NextResponse } from "next/server";
import { saveAgencyTokens } from "@/lib/agency";

// CALLBACK DO OAUTH DA AGÊNCIA (Lucas, 2026-11-27): o Lucas abre o
// link de instalação do app Marketplace dele UMA vez, logado como
// admin da agência, e o HighLevel redireciona pra cá com ?code=...
//   GET /api/openbot/agency/callback?code=...
// Esta URL precisa estar cadastrada como redirect URI no app.
// Aqui o servidor troca o código pelo token de EMPRESA
// (user_type=Company) e guarda access token, refresh token,
// companyId e escopo no Supabase (public.agencia_conexao, linha
// "principal"). Nenhum token aparece na página, no log ou nos erros.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HL_BASE = "https://services.leadconnectorhq.com";
const REDIRECT_URI =
  "https://commander-center-seven.vercel.app/api/openbot/agency/callback";

function plain(status: number, message: string) {
  return new NextResponse(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) {
    return plain(400, "Código de autorização ausente na URL.");
  }

  const clientId = process.env.OPENBOT_AGENCY_CLIENT_ID;
  const clientSecret = process.env.OPENBOT_AGENCY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return plain(
      503,
      "Conexão da agência ainda não configurada no servidor (faltam as credenciais do app).",
    );
  }

  let status = 0;
  let data: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    companyId?: string;
  } | null = null;
  try {
    const res = await fetch(`${HL_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: REDIRECT_URI,
        user_type: "Company",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    status = res.status;
    if (res.ok) data = await res.json();
  } catch {
    return plain(502, "O HighLevel não respondeu à troca do código. Tente instalar de novo.");
  }

  if (!data?.access_token) {
    return plain(
      status || 502,
      "O HighLevel recusou a troca do código de autorização. Gere um link de instalação novo e tente de novo.",
    );
  }

  const saved = await saveAgencyTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    company_id: data.companyId ?? null,
    escopo: data.scope ?? null,
    expires_in: data.expires_in ?? 86399,
  });
  if (!saved) {
    return plain(500, "O token foi emitido, mas não foi possível salvar a conexão. Avise o suporte.");
  }

  const html =
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    "<title>Commander Center</title></head>" +
    '<body style="font-family: system-ui, sans-serif; text-align: center; padding: 3rem;">' +
    "<h1>Agência conectada.</h1><p>Pode fechar esta aba.</p></body></html>";
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
