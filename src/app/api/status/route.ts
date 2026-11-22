import { NextResponse } from "next/server";
import { ACCOUNTS } from "@/lib/accounts";

// Mostra, por conta, se a credencial já foi preenchida no Vercel.
// Nunca devolve o valor da credencial, só presente ou ausente.
export async function GET() {
  const accounts = ACCOUNTS.map((a) => ({
    slug: a.slug,
    name: a.name,
    kind: a.kind,
    sourceStatus: a.sourceStatus,
    locationId: a.locationId,
    credential: a.pitEnv
      ? process.env[a.pitEnv]
        ? "configured"
        : "waiting for credential"
      : "own source or no credential",
  }));
  return NextResponse.json({ accounts });
}
