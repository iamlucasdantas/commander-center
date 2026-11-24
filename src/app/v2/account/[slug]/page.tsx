import Link from "next/link";
import { notFound } from "next/navigation";
import { ACCOUNTS, notConnectedReason } from "@/lib/accounts";
import { fetchV2Account, fmtAge, hlLink } from "@/lib/v2data";
import { accountHealthV2, diagnosisFor } from "@/lib/v2insights";
import { V2_HEALTH_COLOR } from "@/lib/v2insights";
import { money } from "@/lib/insights";
import { SERVICE_CONFIG } from "@/lib/services";
import { getAnalytics } from "@/lib/analytics";
import { TZ } from "@/components/viz";

export const dynamic = "force-dynamic";

/**
 * Página da conta no /v2, versão desta rodada (spec seção 4,
 * nascimento simples): cabeçalho, diagnóstico por regra, cards de
 * decisão (waiting com idade, pipeline, won, fakes), lista de
 * espera, oportunidades e checklist de setup gaps. Speed to lead e
 * Missed calls entram como "connect": dependem de escopos que as
 * chaves atuais não têm. O funil completo e as abas são a etapa 4;
 * a página completa atual continua em /account/[slug].
 */
export default async function V2AccountPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const a = ACCOUNTS.find((x) => x.slug === slug);
  if (!a) notFound();

  const cfg = SERVICE_CONFIG[slug];
  const analytics = await getAnalytics();
  const snap = analytics.sites[slug];
  const back = <Link href="/v2#accounts" className="back">← All accounts</Link>;

  if (slug === "saazid") {
    const yt = analytics.youtube?.["saazid"];
    return (
      <div>
        {back}
        <h1>{a.name}</h1>
        <p className="sub">{cfg?.title ?? "YouTube channel"} · {cfg?.kpiLabel ?? "Main KPI: channel growth"}</p>
        {yt ? (
          <div className="card">
            <div className="label">{yt.handle} · {yt.title}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 34px", marginTop: 10 }}>
              <span><span className="cellnum">{yt.subscribers ?? "—"}</span><small className="note">subscribers</small></span>
              <span><span className="cellnum">{yt.totalViews?.toLocaleString("en-US") ?? "—"}</span><small className="note">total views</small></span>
              <span><span className="cellnum">{yt.videoCount ?? "—"}</span><small className="note">videos</small></span>
            </div>
            <div style={{ marginTop: 10 }}>
              <Link href="/account/saazid" style={{ color: "#F0772E", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>Open the full SAAZID page →</Link>
            </div>
          </div>
        ) : (
          <div className="v2-connect">
            <div className="label">YouTube</div>
            <div className="big">CONNECT</div>
            <p>No YouTube snapshot yet. The daily collector fills this in from the connected channel (@saazidapp).</p>
          </div>
        )}
      </div>
    );
  }

  if (a.sourceStatus !== "hl-location") {
    return (
      <div>
        {back}
        <h1>{a.name}</h1>
        <p className="sub">{cfg?.title ?? "Account"}</p>
        <div className="v2-connect">
          <div className="label">Not connected yet</div>
          <div className="big">CONNECT</div>
          <p>{notConnectedReason(a)}</p>
        </div>
        <p className="foot">
          <Link href={`/account/${slug}`} style={{ color: "#F0772E", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>Open this account in the current version →</Link>
        </p>
      </div>
    );
  }

  const d = await fetchV2Account(a);
  if (!d) {
    return (
      <div>
        {back}
        <h1>{a.name}</h1>
        <div className="alert">The collection failed just now. Use the global Refresh in the top bar, or open this account in the current version.</div>
        <p className="foot">
          <Link href={`/account/${slug}`} style={{ color: "#F0772E", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>Open this account in the current version →</Link>
        </p>
      </div>
    );
  }

  const h = accountHealthV2(d);
  const diagnosis = diagnosisFor(d, snap?.gsc ?? null);
  const fetched = new Date(d.fetchedAt).toLocaleString("en-US", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ,
  });

  return (
    <div>
      {back}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0 }}>{a.name}</h1>
          <p className="sub" style={{ margin: "4px 0 0" }}>
            {cfg ? `${cfg.title} · ${cfg.kpiLabel}` : "Account"} · data from {fetched} Chicago
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btnlink" href={hlLink(a.locationId, "dashboard")} target="_blank" rel="noreferrer">Open in HighLevel</a>
          {a.site && (
            <a className="btn mini" style={{ textDecoration: "none", display: "inline-block" }} href={a.site} target="_blank" rel="noreferrer">
              Open site
            </a>
          )}
        </div>
      </div>

      <div className="v2-diagnosis">
        <span className="v2-status">
          <span className="hdot" style={{ background: V2_HEALTH_COLOR[h.level] }} />
          {h.label}
        </span>
        <span style={{ color: "#B7A69B" }}>{h.reason}</span>
        <p style={{ width: "100%", margin: "2px 0 0", fontSize: 15, lineHeight: 1.6, color: "#FCE3D4" }}>{diagnosis}</p>
      </div>

      <div className="kpis">
        <div className="card" title="Source: HighLevel conversations, verified leads only.">
          <div className="label">Waiting for reply</div>
          <div className="value">{d.waitingCount}</div>
          <div className="hint">{d.waitingOldestMin !== null ? `oldest wait ${fmtAge(d.waitingOldestMin)}` : "nothing waiting"}</div>
        </div>
        <div className="v2-connect" title="Not connected: the conversations messages endpoint answers 401 with the current key scopes.">
          <div className="label">Speed to lead</div>
          <div className="big">CONNECT</div>
          <p>Needs the messages scope on this account's HighLevel key.</p>
        </div>
        <div className="v2-connect" title="Not connected: call detail needs the same messages scope; the conversations endpoint answers 401 today.">
          <div className="label">Missed calls</div>
          <div className="big">CONNECT</div>
          <p>Needs the call detail scope on this account's HighLevel key.</p>
        </div>
        <div className="card" title="Source: HighLevel opportunities, open.">
          <div className="label">Open pipeline</div>
          <div className="value">{money(d.opportunitiesValue)}</div>
          <div className="hint">{d.opportunitiesOpen} open · {money(d.idleValue)} idle 14d+ ({d.idleCount})</div>
        </div>
        <div className="card" title="Source: HighLevel opportunities with status won, changed in the last 30 days.">
          <div className="label">Won · 30 days</div>
          <div className="value">{money(d.won30Value)}</div>
          <div className="hint">{d.won30Count} opportunities won</div>
        </div>
        <div className="card" title="Source: HighLevel contacts matching the fake patterns, last 30 days.">
          <div className="label">Fakes quarantined · 30d</div>
          <div className="value">{d.fakeCount30d}</div>
          <div className="hint">kept out of the metrics</div>
        </div>
      </div>

      {d.waiting.length > 0 && (
        <>
          <h2>Waiting now</h2>
          <div className="card">
            {d.waiting.slice(0, 8).map((w, i) => (
              <div className="conv" key={`${w.contactId}-${i}`}>
                <span>
                  <b>{w.contactName}</b>
                  {w.preview && <span className="preview">“{w.preview}”</span>}
                </span>
                <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flex: "none" }}>
                  <span className={w.ageMin > 24 * 60 ? "down" : w.ageMin > 60 ? "warn" : "hint"} style={{ fontWeight: 700, fontSize: 14 }}>{fmtAge(w.ageMin)}</span>
                  <a className="btn mini" style={{ textDecoration: "none" }} href={hlLink(a.locationId, "conversations")} target="_blank" rel="noreferrer">Reply in HighLevel</a>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {d.topOpportunities.length > 0 && (
        <>
          <h2>Top open opportunities</h2>
          <div className="card">
            {d.topOpportunities.slice(0, 6).map((o) => (
              <div className="rowline" key={o.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid #241D19", fontSize: 14 }}>
                <span>{o.name}<small style={{ color: "#B7A69B", display: "block", fontSize: 12 }}>{o.idle ? "no movement in 14+ days" : "open"}</small></span>
                <b>{o.value > 0 ? money(o.value) : "—"}{o.idle ? <span className="down" style={{ fontSize: 12, marginLeft: 8 }}>idle</span> : null}</b>
              </div>
            ))}
          </div>
        </>
      )}

      {cfg && cfg.pendencies.length > 0 && (
        <>
          <h2>Setup gaps</h2>
          <div className="card">
            {cfg.pendencies.map((p, i) => (
              <div className="v2-gap" key={i}>
                <span className="box" />
                <span style={{ fontSize: 13.5, lineHeight: 1.55 }}>{p}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="foot">
        The full account page of the current version (service blocks, website, log and tasks) is{" "}
        <Link href={`/account/${slug}`} style={{ color: "#F0772E", fontWeight: 600 }}>here</Link>.
        The funnel and the tabs land in step 4 of the 2.0 spec.
      </p>
    </div>
  );
}
