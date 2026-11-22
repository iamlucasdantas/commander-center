import Link from "next/link";
import { notFound } from "next/navigation";
import { ACCOUNTS, KIND_LABEL, hasToken, notConnectedReason } from "@/lib/accounts";
import { PARTNER_ACCOUNT_SLUG, fetchAccountDetail, type AccountDetail } from "@/lib/hl";
import { accountHealth, money, moneyShort } from "@/lib/insights";
import RefreshButton from "@/components/RefreshButton";
import LeadList from "@/components/LeadList";
import PartnerSeparate from "@/components/PartnerSeparate";
import { Delta, HEALTH_COLOR, HeroChart, Ring, Spark, TZ } from "@/components/viz";

export const dynamic = "force-dynamic";

/**
 * Página individual da conta: tudo que a chave de integração privada entrega
 * para aquela location: leads da semana completos, conversas sem resposta,
 * oportunidades abertas e a quarentena da conta. 100% orientada pelo
 * registro (accounts.ts) + presença da env var: conta sem token mostra o
 * estado em vez de quebrar.
 */
export default async function AccountPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = ACCOUNTS.find((x) => x.slug === slug);
  if (!a) notFound();

  const connected = Boolean(a.locationId && a.pitEnv && hasToken(a));
  let detail: AccountDetail | null = null;
  if (connected) {
    try {
      detail = await fetchAccountDetail(a);
    } catch {
      detail = null; // token existe, mas a coleta falhou: mostra o estado, não números zerados
    }
  }

  const now = new Date().toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ, timeZoneName: "short" });
  const m = detail?.metrics;
  const h = m ? accountHealth(m) : null;

  return (
    <div className="wrap">
      <Link className="backlink" href="/">← Commander Center</Link>
      <header className="topo">
        <div>
          <div className="heatbar"><i /><i /><i /><i /></div>
          <div className="wordmark">MAGNETIC FUNNELS</div>
          <h1>{a.name}</h1>
        </div>
        <span style={{ marginLeft: "auto" }}><RefreshButton slug={a.slug} /></span>
      </header>
      <p className="sub">
        {KIND_LABEL[a.kind]}
        {a.site ? <> · <a className="acctlink" href={a.site} target="_blank" rel="noreferrer">{a.site.replace("https://", "")}</a></> : ""}
        {" · "}
        {detail ? <span className="up">Live · updated {now}</span> : <span className="warn">{notConnectedReason(a)}</span>}
      </p>

      {!detail || !m || !h ? (
        <div className="card statuscard">
          <div className="statusbig">{notConnectedReason(a)}</div>
          <p className="hint" style={{ marginTop: 8, maxWidth: 560 }}>
            {a.sourceStatus === "hl-location"
              ? "This account opens as soon as its private integration token is set and the HighLevel collection answers. Nothing is counted in the overview until then."
              : "This account has no HighLevel data source connected yet. It stays out of the overview metrics until a source is connected."}
          </p>
          {a.note && <p className="hint" style={{ marginTop: 8 }}>{a.note}</p>}
        </div>
      ) : (
        <>
          <div className="card healthstrip">
            <Ring pct={h.score} color={HEALTH_COLOR[h.level]} center={`${h.score}`} size={64} />
            <div>
              <div className="healthlbl">{h.label} · {h.short}</div>
              <ul className="reasons">
                {h.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
            <div className="healthside">
              <div className="label">Total contacts</div>
              <div className="cellnum" style={{ fontSize: 22 }}>{m.totalContacts.toLocaleString("en-US")}</div>
            </div>
          </div>

          <div className="hero">
            <div className="hero-main">
              <div className="label">Leads · last 7 days</div>
              <div className="hero-value">{m.leads7d}</div>
              <Delta cur={m.leads7d} prev={m.leadsPrev7d} />
              <div className="hint" style={{ marginTop: 8 }}>{m.leadsToday} today · {m.leads30d} in 30 days</div>
            </div>
            <div className="hero-chart">
              <HeroChart cur={m.leadsByDay30} prev={m.leadsByDayPrev30} />
              <div className="hint"><span style={{ color: "#F0772E" }}>—</span> last 30 days: {m.leads30d} <span style={{ color: "#8A7A70" }}>- -</span> previous 30: {m.leadsPrev30d} · Y axis: leads per day</div>
            </div>
          </div>

          <div className="kpis">
            <div className="card">
              <div className="label">Leads today</div>
              <div className="value">{m.leadsToday}</div>
              <Delta cur={m.leadsToday} prev={m.leadsYesterday} />
              <div style={{ marginTop: 10 }}><Spark data={m.leadsByDay30} w={170} h={34} /></div>
            </div>
            <div className="card">
              <div className="label">Leads · 30 days</div>
              <div className="value">{m.leads30d}</div>
              <Delta cur={m.leads30d} prev={m.leadsPrev30d} />
              <div style={{ marginTop: 10 }}><Spark data={m.leadsByDayPrev30} w={170} h={34} stroke="#8A7A70" /></div>
            </div>
            <div className="card">
              <div className="label">Unread conversations</div>
              <div className="value">{m.unread}</div>
              <div className={m.unread ? "down" : "up"}>{m.unreadConversations ? `${m.unreadConversations} conversation(s) waiting` : "nothing waiting"}</div>
              {m.unreadHot7d > 0 && <div className="hint" style={{ marginTop: 6 }}>{m.unreadHot7d} active this week</div>}
            </div>
            <div className="card">
              <div className="label">Open pipeline</div>
              <div className="value">{money(m.opportunitiesValue)}</div>
              <div className="hint">{m.opportunitiesOpen} open opportunities</div>
              {m.opportunitiesValue > 0 && m.oppStaleValue > 0 && (
                <>
                  <div className="minibar"><i className="bad" style={{ width: `${Math.round((m.oppStaleValue / m.opportunitiesValue) * 100)}%` }} /></div>
                  <div className="hint" style={{ marginTop: 6 }}>{moneyShort(m.oppStaleValue)} idle 14d+</div>
                </>
              )}
            </div>
            <div className="card">
              <div className="label">Fakes quarantined</div>
              <div className="value">{m.fakeCount30d}</div>
              <div className="hint">last 30 days, kept out of the metrics</div>
            </div>
          </div>

          {a.slug === PARTNER_ACCOUNT_SLUG && (
            <div className="card partnercard">
              <PartnerSeparate slug={a.slug} hidden={detail.partnerTotal} separated={detail.partnerSeparated} />
            </div>
          )}

          <h2>New leads this week · {detail.weekLeads.length}</h2>
          <div className="card">
            <LeadList leads={detail.weekLeads} deleteSlug={a.slug} verifySlug={a.slug} emptyText="No new leads in the last 7 days." />
          </div>

          <h2>Conversations</h2>
          <div className="grid2">
            <div className="card">
              <div className="label">Waiting for a reply · {detail.waiting.length}</div>
              {detail.waiting.length ? (
                detail.waiting.map((c, i) => (
                  <div className="conv" key={i}>
                    <span>
                      {c.contactName}
                      <small>
                        {[c.lastActivity, c.channel].filter(Boolean).join(" · ") || "no recent activity"}
                      </small>
                      {c.preview && <span className="preview">“{c.preview}”</span>}
                    </span>
                    <span className="tag unread">{c.unreadCount} unread</span>
                  </div>
                ))
              ) : (
                <p style={{ fontSize: 14, color: "#B7A69B", marginTop: 8 }}>Nobody waiting. Every conversation is answered.</p>
              )}
              {detail.waitingHidden > 0 && (
                <p className="hint" style={{ marginTop: 8 }}>
                  {detail.waitingHidden} waiting conversation{detail.waitingHidden === 1 ? "" : "s"} hidden · this list only shows verified leads
                  {detail.waitingHiddenUnknown > 0 ? ` (${detail.waitingHiddenUnknown} from contacts outside the recent window)` : ""}.
                </p>
              )}
            </div>
            <div className="card">
              <div className="label">Up to date</div>
              <div className="value">{detail.upToDate}</div>
              <div className="hint">
                conversations answered, of {detail.conversationsLoaded} most recent loaded
                {detail.conversationsTotal !== null && detail.conversationsTotal > detail.conversationsLoaded
                  ? ` · ${detail.conversationsTotal} total in this location`
                  : ""}
              </div>
              <div className="minibar" style={{ marginTop: 14 }}>
                <i style={{ width: `${detail.conversationsLoaded ? Math.round((detail.upToDate / detail.conversationsLoaded) * 100) : 0}%` }} />
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                {detail.conversationsLoaded ? Math.round((detail.upToDate / detail.conversationsLoaded) * 100) : 0}% of the recent queue is answered
              </div>
            </div>
          </div>

          <h2>Open opportunities · {detail.opportunities.length}</h2>
          <div className="card">
            {detail.opportunities.length ? (
              detail.opportunities.map((o, i) => (
                <div className="conv" key={i}>
                  <span>
                    {o.name}
                    <small>
                      {[o.stage ?? o.status, o.created ? `opened ${o.created}` : null].filter(Boolean).join(" · ")}
                    </small>
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {o.stale && <span className="tag email">idle 14d+</span>}
                    <b>{money(o.value)}</b>
                  </span>
                </div>
              ))
            ) : (
              <p style={{ fontSize: 14, color: "#B7A69B" }}>No open opportunities right now.</p>
            )}
          </div>

          <h2>Fake leads quarantine · {detail.fakesAll.length}</h2>
          <div className="card">
            {detail.fakesAll.length ? (
              detail.fakesAll.map((f, i) => (
                <div className="fake" key={i}>
                  <span>{f.name}<br /><small>{f.reason}</small></span>
                  <span className="tag fake">fake</span>
                </div>
              ))
            ) : (
              <p style={{ fontSize: 14, color: "#B7A69B" }}>No fakes detected in the last 30 days.</p>
            )}
          </div>
        </>
      )}

      <p className="foot">Commander Center · Magnetic Funnels. Live from HighLevel, 5-minute cache. Trends from contact and opportunity creation dates.</p>
    </div>
  );
}
