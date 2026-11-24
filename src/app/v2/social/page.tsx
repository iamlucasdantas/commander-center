import Link from "next/link";
import { ACCOUNTS } from "@/lib/accounts";
import { getAnalytics } from "@/lib/analytics";
import { pctChange } from "@/lib/insights";

export const dynamic = "force-dynamic";

/**
 * Social & sites no /v2: o resumo dos snapshots que o coletor
 * diário já grava (redes sociais, YouTube do SAAZID e GA4/GSC por
 * conta). A página completa de Social da versão atual continua em
 * /social; aqui entra o essencial para a navegação do 2.0.
 */
export default async function V2SocialPage() {
  const analytics = await getAnalytics();
  const cards = analytics.social?.cards ?? [];
  const yt = analytics.youtube?.["saazid"];
  const contas = ACCOUNTS.filter((a) => a.kind !== "potencial");
  const siteRows = contas
    .map((a) => ({ a, snap: analytics.sites[a.slug] }))
    .filter((r) => r.snap?.ga4?.hasData || r.snap?.gsc)
    .sort((x, y) => (y.snap?.ga4?.sessions28 ?? 0) - (x.snap?.ga4?.sessions28 ?? 0));

  return (
    <div>
      <h1 style={{ fontSize: 24 }}>Social <span className="flame">&amp; sites</span></h1>
      <p className="sub">
        Daily snapshots from the collector · social profiles, the SAAZID channel and per-account GA4 + Search Console ·
        the full Social page of the current version is <Link href="/social" style={{ color: "#F0772E", fontWeight: 600 }}>here</Link>
      </p>

      <h2>Social profiles</h2>
      {cards.length ? (
        <div className="socialgrid">
          {cards.map((c) => (
            <div className="card" key={`${c.network}-${c.handle}`}>
              <div className="label">{c.network} · {c.brand}</div>
              <div className="value" style={{ fontSize: 26 }}>{c.handle}</div>
              <div className="hint">
                {c.followers !== null ? `${c.followers.toLocaleString("en-US")} followers` : "followers not reported"}
                {c.followersDelta28 !== null && c.followersDelta28 !== 0 ? ` · ${c.followersDelta28 > 0 ? "+" : ""}${c.followersDelta28} in 28d` : ""}
              </div>
              <div className="hint">
                {c.views28 !== null ? `${c.views28.toLocaleString("en-US")} views in 28 days` : "no views in the snapshot"}
                {c.profileVisits28 !== null ? ` · ${c.profileVisits28.toLocaleString("en-US")} profile visits` : ""}
              </div>
              {c.note && <div className="hint" style={{ marginTop: 4 }}>{c.note}</div>}
            </div>
          ))}
        </div>
      ) : (
        <div className="card"><p style={{ fontSize: 14, color: "#B7A69B" }}>No social snapshot yet. The daily collector fills this in.</p></div>
      )}

      <h2>SAAZID · YouTube</h2>
      {yt ? (
        <div className="card">
          <div className="label">{yt.handle} · {yt.title}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 34px", marginTop: 10 }}>
            <span><span className="cellnum">{yt.subscribers ?? "—"}</span><small className="note">subscribers</small></span>
            <span><span className="cellnum">{yt.totalViews?.toLocaleString("en-US") ?? "—"}</span><small className="note">total views</small></span>
            <span><span className="cellnum">{yt.videoCount ?? "—"}</span><small className="note">videos</small></span>
          </div>
          <div style={{ marginTop: 10 }}>
            <Link href="/account/saazid" style={{ color: "#F0772E", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>Open the SAAZID page →</Link>
          </div>
        </div>
      ) : (
        <div className="v2-connect">
          <div className="label">SAAZID · YouTube</div>
          <div className="big">CONNECT</div>
          <p>No YouTube snapshot yet. The daily collector fills this in from the connected channel (@saazidapp).</p>
        </div>
      )}

      <h2>Websites · 28 days</h2>
      {siteRows.length ? (
        <div className="v2-tablewrap">
          <table className="v2-table" style={{ minWidth: 640 }}>
            <thead>
              <tr><th>Account</th><th>Sessions</th><th>vs prev</th><th>Search clicks</th><th>Impressions</th><th>CTR</th><th>Avg position</th></tr>
            </thead>
            <tbody>
              {siteRows.map(({ a, snap }) => {
                const d = pctChange(snap?.ga4?.sessions28 ?? 0, snap?.ga4?.sessionsPrev28 ?? 0);
                return (
                  <tr key={a.slug}>
                    <td><b><Link className="acctlink" href={`/v2/account/${a.slug}`}>{a.name}</Link></b></td>
                    <td>{snap?.ga4 ? snap.ga4.sessions28.toLocaleString("en-US") : "—"}</td>
                    <td>{d !== null ? <span className={d > 0 ? "up" : d < 0 ? "down" : "hint"}>{d > 0 ? "▲" : d < 0 ? "▼" : ""} {Math.abs(d)}%</span> : "—"}</td>
                    <td>{snap?.gsc ? snap.gsc.clicks28.toLocaleString("en-US") : "—"}</td>
                    <td>{snap?.gsc ? snap.gsc.impressions28.toLocaleString("en-US") : "—"}</td>
                    <td>{snap?.gsc ? `${(snap.gsc.ctr28 * 100).toFixed(1)}%` : "—"}</td>
                    <td>{snap?.gsc ? snap.gsc.position28.toFixed(1) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card"><p style={{ fontSize: 14, color: "#B7A69B" }}>No site snapshot with data yet.</p></div>
      )}
      <p className="foot">Sources: GA4 and Search Console via the daily collector (Composio), social networks via the connected profiles.</p>
    </div>
  );
}
