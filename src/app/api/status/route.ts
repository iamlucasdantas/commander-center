import { NextResponse } from "next/server";
import { ACCOUNTS } from "@/lib/accounts";
import { getPitToken } from "@/lib/pit";

// Mostra, por conta, se a credencial já foi preenchida (Supabase ou Vercel).
// Nunca devolve o valor da credencial, só presente ou ausente.
export async function GET() {
  const accounts = await Promise.all(
    ACCOUNTS.map(async (a) => ({
      slug: a.slug,
      name: a.name,
      kind: a.kind,
      sourceStatus: a.sourceStatus,
      locationId: a.locationId,
      credential: a.pitEnv
        ? (await getPitToken(a))
          ? "configured"
          : "waiting for credential"
        : "own source or no credential",
    })),
  );
  return NextResponse.json({ accounts });
}
