import Link from "next/link";
import { notFound } from "next/navigation";
import { ACCOUNTS, KIND_LABEL, hasToken, notConnectedReason } from "@/lib/accounts";
import { PARTNER_ACCOUNT_SLUG, fetchAccountDetail, type AccountDetail } from "@/lib/hl";
import { accountHealth, money, moneyShort } from "@/lib/insights";
import { getAnalytics, historyDelta, type YoutubeSnapshot } from "@/lib/analytics";
import RefreshButton from "@/components/RefreshButton";
import LeadList from "@/components/LeadList";
import LogPanel from "@/components/LogPanel";
import PartnerSeparate from "@/components/PartnerSeparate";
import ServiceSection from "@/components/ServiceSection";
import SiteSection from "@/components/SiteSection";
import { getState, stateConfigured } from "@/lib/state";
import { Delta, HEALTH_COLOR, HeroChart, Ring, Spark, TZ } from "@/components/viz";

export const dynamic = "force-dynamic";

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });
}

function signed(n: number | null): string {
  if (n === null) return "—";
  return `${n > 0 ? "+" : ""}${n}`;
}

/** Página do SAAZID: a fonte é o canal do YouTube (@saazidapp), via
 *  snapshot do coletor. Sem CRM: nenhum bloco de HighLevel aqui. */
function SaazidView({ yt, now }: { yt: YoutubeSnapshot | undefined; now: string }) {
  if (!yt) {
    return (
      <div className="card statuscard">
        <div className="statusbig">Waiting for the first YouTube snapshot</div>
        <p className="hint" style={{ marginTop: 8, maxWidth: 560 }}>
          The SAAZID channel (@saazidapp) is collected daily from the connected YouTube account.
          No snapshot has arrived yet, so nothing is shown instead of invented numbers.
        </p>
      </div>
    );
  }
  const subs7 = historyDelta(yt, 7, "subscribers");
  const subs30 = historyDelta(yt, 30, "subscribers");
  const views30 = historyDelta(yt, 30, "totalViews");
  return (
    <>
      <p className="sub">
        YouTube · {yt.handle} · {yt.title} · <span className="up">Snapshot {now}</span>
      </p>
      <div className="hero">
        <div className="hero-main">
          <div className="label">Subscribers</div>
          <div className="hero-value">{yt.subscribers?.toLocaleString("en-US") ?? "—"}</div>
          <div className="hint">
            {subs7 === null && subs30 === null
              ? "Daily snapshots started today; growth deltas appear as they accumulate."
              : `${signed(subs7)} in 7 days · ${signed(subs30)} in 30 days`}
          </div>
        </div>
        <div className="hero-chart">
          <div className="label">Channel</div>
          <p style={{ fontSize: 14, color: "#CBBBAE", lineHeight: 1.7, marginTop: 8, maxWidth: 520 }}>
            SAAZID has no HighLevel account: its panel is the YouTube channel. Growth deltas come from the
            panel&apos;s own daily snapshots, so they sharpen as the collector runs. Watch time, revenue and
            traffic sources would need the channel owner&apos;s Analytics authorization, a later step.
          </p>
          {yt.error && <p className="warn" style={{ marginTop: 8 }}>Last collection note: {yt.error}</p>}
        </div>
      </div>
      <div className="kpis">
        <div className="card">
          <div className="label">Total views</div>
          <div className="value">{yt.totalViews?.toLocaleString("en-US") ?? "—"}</div>
          <div className="hint">{views30 === null ? "deltas accumulate daily" : `${signed(views30)} in 30 days`}</div>
        </div>
        <div className="card">
          <div className="label">Videos published</div>
          <div className="value">{yt.videoCount?.toLocaleString("en-US") ?? "—"}</div>
          <div className="hint">on the channel, all time</div>
        </div>
        <div className="card">
          <div className="label">Latest video</div>
          <div className="value" style={{ fontSize: 22 }}>
            {yt.recentVideos[0] ? fmtDay(yt.recentVideos[0].publishedAt) : "—"}
          </div>
          <div className="hint">{yt.recentVideos[0]?.title ?? "no videos in the snapshot"}</div>
        </div>
      </div>
      <h2>Latest videos</h2>
      <div className="card">
        {yt.recentVideos.length ? (
          yt.recentVideos.map((v) => (
            <div className="conv" key={v.id}>
              <span style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                {v.thumb && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.thumb} alt="" width={104} height={59} style={{ borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                )}
                <span>
                  <a className="acctlink" href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer">
                    {v.title}
                  </a>
                  <small>{fmtDay(v.publishedAt)}</small>
                </span>
              </span>
              <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <b>{v.views?.toLocaleString("en-US") ?? "—"} views</b>
                <small style={{ display: "block", color: "#B7A69B", fontSize: 12 }}>
                  {v.likes?.toLocaleString("en-US") ?? "—"} likes · {v.comments?.toLocaleString("en-US") ?? "—"} comments
                </small>
              </span>
            </div>
          ))
        ) : (
          <p style={{ fontSize: 14, color: "#B7A69B" }}>No videos in the latest snapshot.</p>
        )}
      </div>
    </>
  );
}

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
  const logEntries = stateConfigured() ? (await getState(0)).log : [];
  const analytics = await getAnalytics();

  // SAAZID: página própria, fonte YouTube (sem HighLevel).
  if (a.slug === "saazid") {
    return (
      <div className="wrap">
        <Link className="backlink" href="/">← Commander Center</Link>
        <header className="topo">
          <div>
            <div className="heatbar"><i /><i /><i /><i /></div>
            <div className="wordmark">MAGNETIC FUNNELS</div>
            <h1>{a.name}</h1>
          </div>
        </header>
        <SaazidView yt={analytics.youtube?.saazid} now={now} />
        <h2>Log & tasks</h2>
        <div className="card">
          <LogPanel initialEntries={logEntries} slug={a.slug} />
        </div>
        <p className="foot">Commander Center · Magnetic Funnels. YouTube data from the daily collector snapshot.</p>
      </div>
    );
  }

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
        <>
          <div className="card statuscard">
            <div className="statusbig">{notConnectedReason(a)}</div>
            <p className="hint" style={{ marginTop: 8, maxWidth: 560 }}>
              {a.sourceStatus === "hl-location"
                ? "This account opens as soon as its private integration token is set and the HighLevel collection answers. Nothing is counted in the overview until then."
                : "This account has no HighLevel data source connected yet. It stays out of the overview metrics until a source is connected."}
            </p>
            {a.note && <p className="hint" style={{ marginTop: 8 }}>{a.note}</p>}
          </div>
          <SiteSection slug={a.slug} site={analytics.sites[a.slug]} />
        </>
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

          <ServiceSection slug={a.slug} detail={detail} />
          <SiteSection slug={a.slug} site={analytics.sites[a.slug]} />

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

      <h2>Log & tasks</h2>
      <div className="card">
        <LogPanel initialEntries={logEntries} slug={a.slug} />
      </div>

      <p className="foot">Commander Center · Magnetic Funnels. Live from HighLevel, 5-minute cache. Trends from contact and opportunity creation dates.</p>
    </div>
  );
}
