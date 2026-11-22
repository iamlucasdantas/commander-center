import Link from "next/link";
import { ACCOUNTS, KIND_LABEL, hasToken, notConnectedReason, type Account } from "@/lib/accounts";
import { fetchAccountMetrics, type AccountMetrics } from "@/lib/hl";
import {
  accountHealth, buildAttentionQueue, buildWhatChanged, money, moneyShort, pctChange, vsAverage,
  type AccountData,
} from "@/lib/insights";
import RefreshButton from "@/components/RefreshButton";
import LeadList from "@/components/LeadList";
import { Delta, HEALTH_COLOR, HeroChart, Ring, Spark, TZ } from "@/components/viz";

export const dynamic = "force-dynamic";

const SHORT_NAME: Record<string, string> = {
  "magnetic-funnels-us": "Magnetic Funnels",
  "the-bar-aesthetics": "The Bar",
  "sumthin-different": "Sumthin' Different",
  "qc-aesthetics": "QC Aesthetics",
  "qc-home-renovation": "QC Home Renovation",
  "qc-house-cleaning": "QC House Cleaning",
  "muscatine-tree-service": "Muscatine Tree",
};

function shortName(a: Account): string {
  return SHORT_NAME[a.slug] ?? a.name;
}

/** Donut de composição (fontes de lead + fakes), 30 dias. */
function Donut({ segments }: { segments: Array<{ label: string; value: number; color: string }> }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const R = 54, C = 2 * Math.PI * R;
  let acc = 0;
  const circles = segments.map((s) => {
    const frac = total ? s.value / total : 0;
    const el = (
      <circle key={s.label} cx="75" cy="75" r={R} fill="none" stroke={s.color} strokeWidth="22"
        strokeDasharray={`${Math.max(0, frac * C - 2)} ${C}`} strokeDashoffset={-acc * C}
        transform="rotate(-90 75 75)" />
    );
    acc += frac;
    return el;
  });
  return (
    <div className="donutwrap">
      <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label="Lead mix by source, last 30 days">
        <circle cx="75" cy="75" r={R} fill="none" stroke="#241D19" strokeWidth="22" />
        {circles}
        <text x="75" y="74" textAnchor="middle" fontSize="23" fill="#F7EFE9" style={{ fontFamily: "'Archivo Black', sans-serif" }}>{total}</text>
        <text x="75" y="92" textAnchor="middle" fontSize="10" fill="#B7A69B">contacts · 30d</text>
      </svg>
      <div className="legend">
        {segments.map((s) => (
          <div className="li" key={s.label}>
            <span className="sw" style={{ background: s.color }} />{s.label}
            <span className="lv">{s.value} · {total ? Math.round((s.value / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface WfBar { label: string; from: number; to: number; kind: "total" | "up" | "down" }

/** Waterfall simples do what changed: semana anterior → deltas por conta → semana atual. */
function Waterfall({ bars }: { bars: WfBar[] }) {
  const W = 660, H = 198, T = 22, B = 158;
  const max = Math.max(1, ...bars.map((b) => Math.max(b.from, b.to)));
  const y = (v: number) => B - (v / max) * (B - T);
  const step = (W - 24) / bars.length;
  const barW = Math.min(76, step * 0.55);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} role="img" aria-label="Waterfall of lead change week over week by account">
      {bars.map((b, i) => {
        const cx = 12 + i * step + step / 2;
        const bx = cx - barW / 2;
        const top = y(Math.max(b.from, b.to));
        const hgt = Math.max(2, Math.abs(y(b.from) - y(b.to)));
        const fill = b.kind === "total" ? "#FCE3D4" : b.kind === "up" ? "#EB611C" : "#FF6B6B";
        const delta = b.to - b.from;
        const label = b.kind === "total" ? `${b.to}` : `${delta > 0 ? "+" : ""}${delta}`;
        return (
          <g key={i}>
            {i > 0 && (
              <line x1={12 + (i - 1) * step + step / 2 + barW / 2} x2={bx} y1={y(b.from)} y2={y(b.from)}
                stroke="#5B4A42" strokeWidth="1" strokeDasharray="3 3" />
            )}
            <rect x={bx} y={top} width={barW} height={hgt} rx="5" fill={fill} opacity={b.kind === "total" ? 0.92 : 1} />
            <text x={cx} y={top - 7} textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#FCE3D4">{label}</text>
            <text x={cx} y={178} textAnchor="middle" fontSize="10.5" fill="#B7A69B">{b.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default async function Home() {
  const contas = ACCOUNTS.filter((a) => a.kind !== "potencial");
  const conectaveis = contas.filter((a) => a.sourceStatus === "hl-location");
  const ligadas = conectaveis.filter(hasToken);

  const metrics = new Map<string, AccountMetrics>();
  await Promise.all(
    ligadas.map(async (a) => {
      metrics.set(a.slug, await fetchAccountMetrics(a));
    }),
  );

  // Main view only includes accounts with real data flowing (fetch succeeded).
  // Everything else drops to the collapsed "Not connected yet" section and
  // stays out of the totals, the queue and the feed.
  const live = contas.filter((a) => metrics.get(a.slug)?.ok);
  const notLive = contas.filter((a) => !metrics.get(a.slug)?.ok);
  const data: AccountData[] = live.map((a) => ({ a, m: metrics.get(a.slug)! }));
  const okMetrics = data.map((d) => d.m);
  const sum = (f: (m: AccountMetrics) => number) => okMetrics.reduce((s, m) => s + f(m), 0);

  const leads7d = sum((m) => m.leads7d);
  const leadsPrev = sum((m) => m.leadsPrev7d);
  const leadsHoje = sum((m) => m.leadsToday);
  const leadsOntem = sum((m) => m.leadsYesterday);
  const leads30Total = sum((m) => m.leads30d);
  const leadsPrev30Total = sum((m) => m.leadsPrev30d);
  const unread = sum((m) => m.unread);
  const contasComUnread = okMetrics.filter((m) => m.unread > 0).length;
  const oppValue = sum((m) => m.opportunitiesValue);
  const oppCount = sum((m) => m.opportunitiesOpen);
  const staleValue = sum((m) => m.oppStaleValue);
  const allFakes = okMetrics.flatMap((m) => m.fakes);
  const fakeTotal30d = sum((m) => m.fakeCount30d);
  const avgLeads7d = okMetrics.length ? leads7d / okMetrics.length : 0;
  const maxLeads7d = Math.max(1, ...okMetrics.map((m) => m.leads7d));

  const series30 = Array(30).fill(0) as number[];
  const seriesPrev30 = Array(30).fill(0) as number[];
  okMetrics.forEach((m) => {
    m.leadsByDay30.forEach((v, i) => (series30[i] += v));
    m.leadsByDayPrev30.forEach((v, i) => (seriesPrev30[i] += v));
  });

  const pendingTokens = conectaveis.length - ligadas.length;
  const attention = buildAttentionQueue(data);
  const maxRisk = Math.max(1, ...attention.map((i) => i.moneyAtRisk));
  const changes = buildWhatChanged(data, { leads7d, leadsPrev7d: leadsPrev });
  const healthOf = new Map(data.map((d) => [d.a.slug, accountHealth(d.m)]));
  const healthRank = { red: 3, yellow: 2, green: 1 } as const;

  const topAccount = [...data].sort((x, y) => y.m.leads7d - x.m.leads7d)[0];
  const worstUnread = [...data].filter((d) => d.m.unread > 0).sort((x, y) => y.m.unread - x.m.unread)[0];
  const ranking = [...data].sort((x, y) => y.m.leads7d - x.m.leads7d);

  // Donut: composição de fontes dos leads limpos (30d) + fakes.
  const sourceTotals = new Map<string, number>();
  okMetrics.forEach((m) => Object.entries(m.sourceCounts).forEach(([k, v]) => sourceTotals.set(k, (sourceTotals.get(k) ?? 0) + v)));
  const SOURCE_STYLE: Array<[string, string]> = [
    ["Form", "#EB611C"], ["Calendar", "#F0772E"], ["Chat", "#C0240A"], ["Workflow", "#FCE3D4"],
    ["Survey", "#B7A69B"], ["Quiz", "#8A7A70"], ["Other", "#6B5B52"], ["Stray email", "#4A3E38"],
  ];
  const donutSegments = SOURCE_STYLE
    .map(([label, color]) => ({ label, color, value: sourceTotals.get(label) ?? 0 }))
    .filter((s) => s.value > 0);
  if (fakeTotal30d > 0) donutSegments.push({ label: "Fakes (quarantined)", color: "#FF6B6B", value: fakeTotal30d });

  // Waterfall: semana anterior → maiores deltas por conta → semana atual.
  const wfDeltas = data
    .map((d) => ({ name: shortName(d.a), delta: d.m.leads7d - d.m.leadsPrev7d }))
    .filter((d) => d.delta !== 0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const wfTop = wfDeltas.slice(0, 4);
  const wfOther = wfDeltas.slice(4).reduce((s, d) => s + d.delta, 0);
  if (wfOther !== 0) wfTop.push({ name: "Other accounts", delta: wfOther });
  const wfBars: WfBar[] = [{ label: "Last week", from: 0, to: leadsPrev, kind: "total" }];
  let cum = leadsPrev;
  for (const d of wfTop) {
    wfBars.push({ label: d.name, from: cum, to: cum + d.delta, kind: d.delta > 0 ? "up" : "down" });
    cum += d.delta;
  }
  wfBars.push({ label: "This week", from: 0, to: leads7d, kind: "total" });

  const groups: Array<{ title: string; kinds: Account["kind"][] }> = [
    { title: "Company & community", kinds: ["empresa", "comunidade"] },
    { title: "Clients", kinds: ["cliente"] },
    { title: "Own brands & projects", kinds: ["projeto"] },
  ];
  const now = new Date().toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ, timeZoneName: "short" });

  return (
    <div className="wrap">
      <header className="topo">
        <div>
          <div className="heatbar"><i /><i /><i /><i /></div>
          <div className="wordmark">MAGNETIC FUNNELS</div>
          <h1>Commander <span className="flame">Center</span></h1>
        </div>
        <span style={{ marginLeft: "auto" }}><RefreshButton /></span>
      </header>
      <p className="sub">Updated {now} · {okMetrics.length} of {conectaveis.length} locations live · clean leads only, fakes excluded</p>

      <div className="hero">
        <div className="hero-main">
          <div className="label">Portfolio leads · last 7 days</div>
          <div className="hero-value">{leads7d}</div>
          <Delta cur={leads7d} prev={leadsPrev} />
          <div className="hint" style={{ marginTop: 8 }}>{leadsHoje} today · {leads30Total} in 30 days</div>
        </div>
        <div className="hero-chart">
          <HeroChart cur={series30} prev={seriesPrev30} />
          <div className="hint"><span style={{ color: "#F0772E" }}>—</span> last 30 days: {leads30Total} <span style={{ color: "#8A7A70" }}>- -</span> previous 30: {leadsPrev30Total} · Y axis: leads per day</div>
        </div>
      </div>

      <div className="kpis">
        <div className="card">
          <div className="label">Leads today</div>
          <div className="value">{leadsHoje}</div>
          <Delta cur={leadsHoje} prev={leadsOntem} />
          <div style={{ marginTop: 10 }}><Spark data={series30} w={170} h={34} /></div>
        </div>
        <div className="card">
          <div className="label">Unread conversations</div>
          <div className="value">{unread}</div>
          <div className={unread ? "down" : "up"}>{contasComUnread ? `${contasComUnread} account(s) waiting` : "nothing waiting"}</div>
          {worstUnread && unread > 0 && (
            <>
              <div className="minibar"><i className="bad" style={{ width: `${Math.round((worstUnread.m.unread / unread) * 100)}%` }} /></div>
              <div className="hint" style={{ marginTop: 6 }}>worst: {shortName(worstUnread.a)} ({worstUnread.m.unread})</div>
            </>
          )}
        </div>
        <div className="card">
          <div className="label">Open pipeline</div>
          <div className="value">{money(oppValue)}</div>
          <div className="hint">{oppCount} open opportunities</div>
          {oppValue > 0 && staleValue > 0 && (
            <>
              <div className="minibar"><i className="bad" style={{ width: `${Math.round((staleValue / oppValue) * 100)}%` }} /></div>
              <div className="hint" style={{ marginTop: 6 }}>{moneyShort(staleValue)} idle 14d+</div>
            </>
          )}
        </div>
        <div className="card">
          <div className="label">Fakes quarantined</div>
          <div className="value">{fakeTotal30d}</div>
          <div className="hint">kept out of the metrics</div>
          {leads30Total + fakeTotal30d > 0 && (
            <div className="minibar"><i className="bad" style={{ width: `${Math.round((fakeTotal30d / (leads30Total + fakeTotal30d)) * 100)}%` }} /></div>
          )}
        </div>
        <div className="card">
          <div className="label">Connected accounts</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
            <Ring pct={conectaveis.length ? (okMetrics.length / conectaveis.length) * 100 : 0} color="#EB611C" center={`${okMetrics.length}/${conectaveis.length}`} size={52} />
            {pendingTokens > 0 ? <div className="warn">{pendingTokens} waiting<br />for token</div> : <div className="up">all locations<br />connected</div>}
          </div>
        </div>
      </div>

      <h2>Needs your attention</h2>
      {attention.length ? (
        <div className="queue">
          {attention.map((item, i) => (
            <div className={`qitem sev${item.severity}`} key={`${item.slug}-${i}`}>
              <div className="qmetric">{item.metric}</div>
              <div className="qmain">
                <div className="qhead"><b><Link className="acctlink" href={`/account/${item.slug}`}>{item.account}</Link></b><span className="qheadline">{item.headline}</span></div>
                <div className="riskbar"><i style={{ width: `${item.moneyAtRisk > 0 ? Math.max(3, Math.round((item.moneyAtRisk / maxRisk) * 100)) : 0}%` }} /></div>
                <div className="qmeta">
                  <span>{item.moneyAtRisk > 0 ? `${money(item.moneyAtRisk)} at risk` : "no pipeline value"}</span>
                  <span className="qaction">{item.action}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="alert"><b>All clear:</b> no queue exploding, no lead source collapsed, no pipeline stuck.</div>
      )}

      <h2>What changed · leads week over week</h2>
      <div className="grid2">
        <div className="card">
          <Waterfall bars={wfBars} />
        </div>
        <div className="card changes">
          {changes.length ? changes.map((c, i) => (
            <div className="change" key={i}>
              <span className={c.tone === "good" ? "up" : c.tone === "bad" ? "down" : "hint"}>{c.tone === "good" ? "▲" : c.tone === "bad" ? "▼" : "●"}</span>
              <span>{c.text}</span>
            </div>
          )) : (
            <p style={{ fontSize: 14, color: "#B7A69B" }}>No big moves this week.</p>
          )}
        </div>
      </div>

      <h2>Accounts by leads · 7 days</h2>
      <div className="card">
        <div className="rank">
          {ranking.map(({ a, m }) => {
            const h = healthOf.get(a.slug)!;
            const pct = pctChange(m.leads7d, m.leadsPrev7d);
            return (
              <Link className="rank-row" href={`/account/${a.slug}`} key={a.slug}>
                <span className={`hdot ${h.level}`} title={`${h.label}: ${h.reasons.join("; ")}`} />
                <span className="rank-name">{shortName(a)}</span>
                <span className="rank-track"><i style={{ width: `${Math.round((m.leads7d / maxLeads7d) * 100)}%` }} /></span>
                <span className="rank-val">{m.leads7d}</span>
                <span className={`rank-delta ${pct === null ? "" : pct > 0 ? "up" : pct < 0 ? "down" : ""}`}>
                  {pct === null ? (m.leads7d > 0 ? "new" : "—") : pct === 0 ? "flat" : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%`}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      <h2>Lead mix · 30 days</h2>
      <div className="card">
        {donutSegments.length ? <Donut segments={donutSegments} /> : (
          <p style={{ fontSize: 14, color: "#B7A69B" }}>No contacts in the last 30 days.</p>
        )}
      </div>

      {groups.map((g) => {
        const rows = data
          .filter((d) => g.kinds.includes(d.a.kind))
          .sort((x, y) =>
            (healthRank[healthOf.get(y.a.slug)!.level] - healthRank[healthOf.get(x.a.slug)!.level]) ||
            (y.m.unread - x.m.unread) ||
            (y.m.leads7d - x.m.leads7d));
        if (rows.length === 0) return null;
        return (
          <section key={g.title}>
            <h2>{g.title}</h2>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr><th>Account</th><th>Health</th><th>Leads 7d</th><th>Trend, 30d</th><th>Unread</th><th>Opportunities</th><th></th></tr>
                </thead>
                <tbody>
                  {rows.map(({ a, m }) => {
                    const h = healthOf.get(a.slug)!;
                    const vs = vsAverage(m.leads7d, avgLeads7d);
                    return (
                      <tr key={a.slug}>
                        <td><b><Link className="acctlink" href={`/account/${a.slug}`}>{a.name}</Link></b><small className="note">{KIND_LABEL[a.kind]}{a.note ? `, ${a.note}` : ""}</small></td>
                        <td>
                          <div className="ringwrap" title={h.reasons.join("; ")}>
                            <Ring pct={h.score} color={HEALTH_COLOR[h.level]} center={`${h.score}`} />
                            <span><span className="ringlbl">{h.label}</span><small className="note">{h.short}</small></span>
                          </div>
                        </td>
                        <td>
                          <span className="cellnum">{m.leads7d}</span><br />
                          <Delta cur={m.leads7d} prev={m.leadsPrev7d} />
                          <div className="bullet"><i style={{ width: `${Math.round((m.leads7d / maxLeads7d) * 100)}%` }} /><b style={{ left: `${Math.min(100, Math.round((avgLeads7d / maxLeads7d) * 100))}%` }} /></div>
                          {vs && <small className="note">{vs} (bar marker)</small>}
                        </td>
                        <td><Spark data={m.leadsByDay30} showPeak /></td>
                        <td>{m.unread > 0 ? <span className={m.unread >= 25 ? "down" : "warn"} style={{ fontWeight: 700, fontSize: 15 }}>{m.unread}</span> : 0}</td>
                        <td>{money(m.opportunitiesValue)}<small className="note">{m.opportunitiesOpen} open{m.oppStaleValue > 0 ? `, ${moneyShort(m.oppStaleValue)} idle 14d+` : ""}</small></td>
                        <td><RefreshButton slug={a.slug} mini /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <div className="grid2">
        <div className="card">
          <div className="label">Drill-down{topAccount ? <>, <Link className="acctlink" href={`/account/${topAccount.a.slug}`}>{topAccount.a.name}</Link>, this week's leads</> : ""}</div>
          {topAccount ? (
            <LeadList leads={topAccount.m.recentLeads} emptyText="No leads in the last 7 days." />
          ) : (
            <p style={{ fontSize: 14, color: "#B7A69B", marginTop: 8 }}>No leads in the last 7 days.</p>
          )}
        </div>
        <div className="card">
          <div className="label">Fake leads quarantine</div>
          {allFakes.length ? (
            allFakes.slice(0, 8).map((f, i) => (
              <div className="fake" key={i}>
                <span>{f.name}<br /><small>{f.account}, {f.reason}</small></span>
                <span className="tag fake">fake</span>
              </div>
            ))
          ) : (
            <p style={{ fontSize: 14, color: "#B7A69B", marginTop: 8 }}>No fakes detected in the last 30 days.</p>
          )}
        </div>
      </div>

      <h2>Roadmap</h2>
      <div className="card">
        <ul className="steps">
          <li><span className="done">✓</span> Live HighLevel collection, fakes excluded</li>
          <li><span className="done">✓</span> Decision layer: attention queue, health rings, 30d trends, waterfall</li>
          <li><span className="todo">→</span> Tokens for the 2 community accounts (9 of 9 locations)</li>
          <li><span className="todo">→</span> GA4 traffic line crossed with leads</li>
          <li><span className="todo">→</span> Persisted snapshots and real per-account goals</li>
        </ul>
      </div>

      {notLive.length > 0 && (
        <details className="card notconnected">
          <summary>Not connected yet ({notLive.length})</summary>
          <div style={{ marginTop: 8 }}>
            {notLive.map((a) => (
              <div className="nc-row" key={a.slug}>
                <span><b><Link className="acctlink" href={`/account/${a.slug}`}>{a.name}</Link></b>{a.note && <small className="note">{a.note}</small>}</span>
                <span className="nc-reason">{notConnectedReason(a)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="foot">Commander Center · Magnetic Funnels. Live from HighLevel, 5-minute cache. Trends from contact and opportunity creation dates.</p>
    </div>
  );
}
