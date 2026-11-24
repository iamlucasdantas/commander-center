import Link from "next/link";
import { ACCOUNTS } from "@/lib/accounts";
import { fetchAllV2, fmtAge, hlLink } from "@/lib/v2data";

export const dynamic = "force-dynamic";

/**
 * Waiting for reply (spec 2026-11-24): todas as conversas cuja
 * última mensagem é do cliente, de leads verificados, ordenadas
 * pela idade da espera. É a lista por trás do card e do badge.
 */
export default async function WaitingPage() {
  const contas = ACCOUNTS.filter((a) => a.kind !== "potencial");
  const data = await fetchAllV2(contas);
  const bySlug = new Map(contas.map((a) => [a.slug, a]));

  const rows = data
    .flatMap((d) => d.waiting.map((w) => ({ d, w, a: bySlug.get(d.slug)! })))
    .sort((x, y) => y.w.ageMin - x.w.ageMin);

  const over1h = rows.filter((r) => r.w.ageMin > 60).length;
  const over24h = rows.filter((r) => r.w.ageMin > 24 * 60).length;

  return (
    <div>
      <h1 style={{ fontSize: 24 }}>Waiting for <span className="flame">reply</span></h1>
      <p className="sub">
        {rows.length} conversation{rows.length === 1 ? "" : "s"} where the client spoke last · {over1h} over 1h · {over24h} over 24h ·
        verified leads only · source: HighLevel conversations
      </p>

      {rows.length ? (
        <div className="card">
          {rows.map((r, i) => (
            <div className="conv" key={`${r.d.slug}-${r.w.contactId}-${i}`}>
              <span>
                <b>{r.w.contactName}</b>
                <small>
                  <Link className="acctlink" href={`/v2/account/${r.d.slug}`}>{r.a.name}</Link>
                  {r.w.channel ? ` · ${r.w.channel}` : ""}
                  {r.w.unread > 0 ? ` · ${r.w.unread} unread` : ""}
                </small>
                {r.w.preview && <span className="preview">“{r.w.preview}”</span>}
              </span>
              <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flex: "none" }}>
                <span className={r.w.ageMin > 24 * 60 ? "down" : r.w.ageMin > 60 ? "warn" : "hint"} style={{ fontWeight: 700, fontSize: 14 }}>
                  {fmtAge(r.w.ageMin)}
                </span>
                <a className="btn mini" style={{ textDecoration: "none" }} href={hlLink(r.a.locationId, "conversations")} target="_blank" rel="noreferrer">
                  Reply in HighLevel
                </a>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="alert"><b>All clear:</b> no verified client is waiting for a reply right now.</div>
      )}

      <p className="foot">The wait starts at the client's last message. Conversations from unverified, fake or Partner contacts stay out, by the panel rule of 2026-11-22.</p>
    </div>
  );
}
