// Página Social (Fase 3, ordem do Lucas, 2026-11-22): um cartão por
// rede e conta, agrupado pela MARCA dona, porque um mesmo perfil
// (@iamlucasdantas) serve a várias marcas e não há mapa 1 para 1 com
// as locations do HighLevel. Os números vêm do snapshot diário do
// coletor (lib/analytics.ts), janela de 28 dias. Cartão sem fonte
// simplesmente não aparece: nada de número inventado.
import Link from "next/link";
import { getAnalytics, type SocialCard } from "@/lib/analytics";
import { TZ } from "@/components/viz";

export const dynamic = "force-dynamic";

const NETWORK_LABEL: Record<SocialCard["network"], string> = {
  instagram: "Instagram",
  threads: "Threads",
  facebook: "Facebook Page",
};

function num(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : v.toLocaleString("en-US");
}

function deltaChip(v: number | null): React.ReactNode {
  if (v === null) return <span className="hint">no delta in this snapshot</span>;
  if (v === 0) return <span className="hint">flat in 28 days</span>;
  return (
    <span className={v > 0 ? "up" : "down"}>
      {v > 0 ? "▲" : "▼"} {Math.abs(v).toLocaleString("en-US")} followers in 28 days
    </span>
  );
}

export default async function SocialPage() {
  const analytics = await getAnalytics();
  const social = analytics.social;
  const yt = analytics.youtube?.saazid;
  const now = new Date().toLocaleString("en-US", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ, timeZoneName: "short",
  });

  const brands = new Map<string, SocialCard[]>();
  for (const c of social?.cards ?? []) {
    if (!brands.has(c.brand)) brands.set(c.brand, []);
    brands.get(c.brand)!.push(c);
  }

  return (
    <div className="wrap">
      <Link className="backlink" href="/">← Commander Center</Link>
      <header className="topo">
        <div>
          <div className="heatbar"><i /><i /><i /><i /></div>
          <div className="wordmark">MAGNETIC FUNNELS</div>
          <h1>Social</h1>
        </div>
      </header>
      <p className="sub">
        Followers, views and interactions of the connected profiles, last 28 days
        {social ? <> · snapshot {new Date(social.collectedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ })} (Chicago)</> : <> · updated {now}</>}
      </p>

      {!social || social.cards.length === 0 ? (
        <div className="card statuscard">
          <div className="statusbig">Waiting for the first social snapshot</div>
          <p className="hint" style={{ marginTop: 8, maxWidth: 560 }}>
            The daily collector reads Instagram, Threads and the Facebook Pages from the connected accounts
            and records a snapshot here. None has arrived yet.
          </p>
        </div>
      ) : (
        <>
          {[...brands.entries()].map(([brand, cards]) => (
            <section key={brand}>
              <h2>{brand}</h2>
              <div className="socialgrid">
                {cards.map((c) => (
                  <div className="card" key={`${c.network}-${c.handle}`}>
                    <div className="label">{NETWORK_LABEL[c.network]}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginTop: 6 }}>{c.handle}</div>
                    <div className="value">{num(c.followers)}</div>
                    <div className="hint">followers</div>
                    <div style={{ marginTop: 6 }}>{deltaChip(c.followersDelta28)}</div>
                    <div style={{ marginTop: 12, display: "grid", gap: 5, fontSize: 13.5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#B7A69B" }}>Views · 28d</span><b>{num(c.views28)}</b>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#B7A69B" }}>Interactions · 28d</span><b>{num(c.interactions28)}</b>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#B7A69B" }}>Profile visits · 28d</span><b>{num(c.profileVisits28)}</b>
                      </div>
                    </div>
                    {c.accountSlug && (
                      <div style={{ marginTop: 12 }}>
                        <Link className="acctlink" href={`/account/${c.accountSlug}`} style={{ color: "#F0772E", fontWeight: 600, fontSize: 13 }}>
                          Open the account →
                        </Link>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      <h2>SAAZID · YouTube</h2>
      <div className="card">
        {yt ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>
            <div>
              <div className="label">YouTube · {yt.handle}</div>
              <div className="value">{num(yt.subscribers)} subscribers</div>
              <div className="hint">
                {num(yt.totalViews)} total views · {num(yt.videoCount)} videos
              </div>
            </div>
            <span style={{ marginLeft: "auto" }}>
              <Link className="btn" href="/account/saazid" style={{ textDecoration: "none" }}>Open the SAAZID panel</Link>
            </span>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "#B7A69B" }}>No YouTube snapshot yet.</p>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="label">Not connected yet</div>
        <ul className="steps" style={{ marginTop: 4 }}>
          <li><span className="todo">→</span> Instagram of Wrexham Brasil (@wrexhamafcbrasil): the account is not connected, so only its Facebook Page and website appear in the panel.</li>
          <li><span className="todo">→</span> SAAZID on other networks: only the YouTube channel is connected today.</li>
          <li><span className="todo">→</span> Client Pages beyond GypsyHighway stay out of this page by default; they enter if Lucas asks.</li>
        </ul>
      </div>

      <p className="foot">Commander Center · Magnetic Funnels. Social data from the daily collector snapshot, 28-day window.</p>
    </div>
  );
}
