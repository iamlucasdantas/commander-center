// Bloco universal de site (ordem do Lucas, 2026-11-22): TODA conta
// tem métricas do próprio site, do GA4 quando ele existe ou das
// métricas do HighLevel quando o site mora lá, mais o Search Console
// onde houver propriedade. Os números vêm dos snapshots que o coletor
// grava (lib/analytics.ts); sem fonte, o bloco diz "sem fonte de
// analytics" em vez de inventar número.
import { SITE_SOURCES } from "@/lib/accounts";
import type { SiteSnapshot } from "@/lib/analytics";
import { Delta, Spark, TZ } from "./viz";

function collectedLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ,
  });
}

export default function SiteSection({ slug, site }: { slug: string; site?: SiteSnapshot }) {
  const src = SITE_SOURCES[slug];
  const hasSource = Boolean(src && ((src.ga4?.length ?? 0) > 0 || (src.gsc?.length ?? 0) > 0));
  const ga4 = site?.ga4;
  const gsc = site?.gsc;

  return (
    <>
      <h2>Website</h2>
      <div className="card">
        {!hasSource ? (
          <>
            <div className="label">No analytics source</div>
            <p style={{ fontSize: 14, color: "#B7A69B", marginTop: 8 }}>
              No analytics source is connected for this account&apos;s site yet: no GA4 property and no
              Search Console site were found in the connected accounts. Nothing is estimated here.
            </p>
          </>
        ) : !site ? (
          <>
            <div className="label">Waiting for the first snapshot</div>
            <p style={{ fontSize: 14, color: "#B7A69B", marginTop: 8 }}>
              A source exists for this site, but the daily collector has not delivered a snapshot yet.
            </p>
          </>
        ) : (
          <>
            {ga4 && (
              <div style={{ marginBottom: gsc ? 18 : 0 }}>
                <div className="label">
                  Google Analytics · last 28 days{ga4.properties > 1 ? ` · ${ga4.properties} properties summed` : ""}
                </div>
                {!ga4.hasData ? (
                  <p style={{ fontSize: 14, color: "#B7A69B", marginTop: 8 }}>
                    GA4 connected, no data in the period: the property answered, but recorded no sessions
                    in the last 28 days.
                  </p>
                ) : (
                  <>
                    <div className="kpis" style={{ marginTop: 12 }}>
                      <div>
                        <div className="label">Sessions</div>
                        <div className="value">{ga4.sessions28.toLocaleString("en-US")}</div>
                        <Delta cur={ga4.sessions28} prev={ga4.sessionsPrev28} />
                      </div>
                      <div>
                        <div className="label">Users</div>
                        <div className="value">{ga4.users28.toLocaleString("en-US")}</div>
                        <Delta cur={ga4.users28} prev={ga4.usersPrev28} />
                      </div>
                      <div>
                        <div className="label">Page views</div>
                        <div className="value">{ga4.views28.toLocaleString("en-US")}</div>
                        <Delta cur={ga4.views28} prev={ga4.viewsPrev28} />
                      </div>
                      <div>
                        <div className="label">Sessions per day</div>
                        <div style={{ marginTop: 10 }}>
                          <Spark data={ga4.byDay} w={190} h={44} showPeak />
                        </div>
                        <div className="hint">last 28 days</div>
                      </div>
                    </div>
                    {ga4.channels.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {ga4.channels.map((c) => (
                          <div className="conv" key={c.name}>
                            <span>{c.name}</span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                              <span className="minibar" style={{ width: 110, marginTop: 0 }}>
                                <i style={{ width: `${ga4.sessions28 ? Math.max(2, Math.round((c.sessions / ga4.sessions28) * 100)) : 0}%` }} />
                              </span>
                              <b>{c.sessions.toLocaleString("en-US")}</b>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {gsc && (
              <div>
                <div className="label">
                  Google Search Console · last 28 days{gsc.sites > 1 ? ` · ${gsc.sites} sites summed` : ""}
                </div>
                <div className="kpis" style={{ marginTop: 12 }}>
                  <div>
                    <div className="label">Clicks</div>
                    <div className="value">{gsc.clicks28.toLocaleString("en-US")}</div>
                  </div>
                  <div>
                    <div className="label">Impressions</div>
                    <div className="value">{gsc.impressions28.toLocaleString("en-US")}</div>
                  </div>
                  <div>
                    <div className="label">CTR</div>
                    <div className="value">{(gsc.ctr28 * 100).toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="label">Avg. position</div>
                    <div className="value">{gsc.position28 ? gsc.position28.toFixed(1) : "—"}</div>
                  </div>
                </div>
                {gsc.topQueries.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div className="label" style={{ marginBottom: 4 }}>Top searches</div>
                    {gsc.topQueries.map((q) => (
                      <div className="conv" key={q.query}>
                        <span>
                          {q.query}
                          <small>{q.impressions.toLocaleString("en-US")} impressions · position {q.position.toFixed(1)}</small>
                        </span>
                        <b>{q.clicks.toLocaleString("en-US")} clicks</b>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <p className="hint" style={{ marginTop: 12 }}>
              Snapshot collected {collectedLabel(site.collectedAt)} (Chicago) by the daily collector from the
              connected Google accounts. Search Console data lags about 3 days.
            </p>
          </>
        )}
      </div>
    </>
  );
}
