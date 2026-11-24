import { NextResponse } from "next/server";
import { mutateV2State, v2StateConfigured } from "@/lib/v2state";

// Ações da Action queue do /v2 (spec 2026-11-24): Snooze 1 dia e
// Done. Escreve SÓ no documento próprio do v2 (v2-state.json);
// nenhuma escrita no HighLevel nem no estado da versão atual.
// POST /api/v2/queue { key, action: "snooze" | "done" | "reset", signature }
export async function POST(req: Request) {
  if (!v2StateConfigured()) {
    return NextResponse.json({ ok: false, error: "Panel storage is not configured" }, { status: 503 });
  }
  let body: { key?: unknown; action?: unknown; signature?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const key = typeof body.key === "string" ? body.key : "";
  const action = body.action;
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!key || (action !== "snooze" && action !== "done" && action !== "reset")) {
    return NextResponse.json({ ok: false, error: "Missing key or action" }, { status: 400 });
  }

  try {
    const state = await mutateV2State((s) => {
      if (action === "reset") {
        delete s.queue[key];
      } else if (action === "snooze") {
        s.queue[key] = {
          status: "snoozed",
          at: new Date().toISOString(),
          until: new Date(Date.now() + 24 * 3600_000).toISOString(),
          signature,
        };
      } else {
        s.queue[key] = { status: "done", at: new Date().toISOString(), signature };
      }
    });
    return NextResponse.json({ ok: true, mark: state.queue[key] ?? null });
  } catch {
    return NextResponse.json({ ok: false, error: "The queue state could not be saved" }, { status: 500 });
  }
}
