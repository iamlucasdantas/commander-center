import { ACCOUNTS, type Account } from "@/lib/accounts";
import { fetchAccountMetrics, type AccountMetrics } from "@/lib/hl";
import {
  accountHealth, buildAttentionQueue, buildWhatChanged, money, pctChange, vsAverage,
  type AccountData,
} from "@/lib/insights";
import RefreshButton from "@/components/RefreshButton";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<Account["kind"], string> = {
  empresa: "Company",
  comunidade: "Community",
  cliente: "Client",
  projeto: "Project",
  potencial: "Prospect",
};

function hasToken(a: Account): boolean {
  return Boolean(a.pitEnv && process.env[a.pitEnv]);
}

/** Short reason shown in the "Not connected yet" section for accounts with no live data. */
function notConnectedReason(a: Account): string {
  if (a.sourceStatus === "hl-location") {
    return hasToken(a) ? "Connected, but no data yet" : "Waiting for token";
  }
  if (a.sourceStatus === "sem-subconta") return "No HighLevel account yet";
  if (a.sourceStatus === "propria") return "Own data source, not connected yet";
  return "Lead source not mapped yet";
}

/** Sparkline SVG a partir de uma série diária. Server-rendered, sem JS. */
function Spark({ data, w = 110, h = 30, stroke = "#EF4F18", fill = true }: {
  data: number[]; w?: number; h?: number; stroke?: string; fill?: boolean;
}) {
  const max = Math.max(1, ...data);
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - 3 - (v / max) * (h - 6)).toFixed(1)}`);
  const line = pts.join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ display: "block" }}>
      {fill && <polygon points={area} fill={stroke} opacity="0.14" />}
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

/** Chip de variação contra o período anterior. invert=true quando subir é ruim (ex.: não lidas). */
function Delta({ cur, prev, invert = false }: { cur: number; prev: number; invert?: boolean }) {
  const pct = pctChange(cur, prev);
  if (pct === null) return <span className="hint">no baseline yet</span>;
  if (pct === 0) return <span className="hint">flat vs previous period</span>;
  const good = invert ? pct < 0 : pct > 0;
  return (
    <span className={good ? "up" : "down"}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}% vs previous period
    </span>
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
  const unread = sum((m) => m.unread);
  const contasComUnread = okMetrics.filter((m) => m.unread > 0).length;
  const oppValue = sum((m) => m.opportunitiesValue);
  const oppCount = sum((m) => m.opportunitiesOpen);
  const staleValue = sum((m) => m.oppStaleValue);
  const allFakes = okMetrics.flatMap((m) => m.fakes);
  const avgLeads7d = okMetrics.length ? leads7d / okMetrics.length : 0;

  const series30 = Array(30).fill(0) as number[];
  const seriesPrev30 = Array(30).fill(0) as number[];
  okMetrics.forEach((m) => {
    m.leadsByDay30.forEach((v, i) => (series30[i] += v));
    m.leadsByDayPrev30.forEach((v, i) => (seriesPrev30[i] += v));
  });
  const chartMax = Math.max(1, ...series30, ...seriesPrev30);
  const chartLine = (s: number[]) =>
    s.map((v, i) => `${Math.round((i / 29) * 600)},${Math.round(150 - (v / chartMax) * 120)}`).join(" ");

  const pendingTokens = conectaveis.length - ligadas.length;
  const attention = buildAttentionQueue(data);
  const changes = buildWhatChanged(data, { leads7d, leadsPrev7d: leadsPrev });
  const healthOf = new Map(data.map((d) => [d.a.slug, accountHealth(d.m)]));
  const healthRank = { red: 3, yellow: 2, green: 1 } as const;

  const topAccount = [...data].sort((x, y) => y.m.leads7d - x.m.leads7d)[0];
  const worstUnread = [...data].filter((d) => d.m.unread > 0).sort((x, y) => y.m.unread - x.m.unread)[0];

  const groups: Array<{ title: string; kinds: Account["kind"][] }> = [
    { title: "Company & community", kinds: ["empresa", "comunidade"] },
    { title: "Clients", kinds: ["cliente"] },
    { title: "Own brands & projects", kinds: ["projeto"] },
  ];
  const now = new Date().toLocaleString("en-US", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="wrap">
      <header className="topo">
        <h1><span className="magnet">🧲 Commander</span> Center</h1>
        <span style={{ marginLeft: "auto" }}><RefreshButton /></span>
      </header>
      <p className="sub">Decision view, connected accounts only. Clean leads, fakes excluded. Updated {now}. {okMetrics.length} of {conectaveis.length} HighLevel locations are live.</p>

      <div className="hero">
        <div className="hero-main">
          <div className="label">Portfolio leads, last 7 days</div>
          <div className="hero-value">{leads7d}</div>
          <Delta cur={leads7d} prev={leadsPrev} />
          <div className="hint" style={{ marginTop: 6 }}>{leadsHoje} today across {okMetrics.length} connected accounts, {sum((m) => m.leads30d)} in the last 30 days</div>
        </div>
        <div className="hero-chart">
          <Spark data={series30} w={520} h={110} stroke="#EF4F18" />
          <div className="hint">Clean leads per day, last 30 days, all connected accounts</div>
        </div>
      </div>

      <div className="kpis">
        <div className="card"><div className="label">Leads today</div><div className="value">{leadsHoje}</div><Delta cur={leadsHoje} prev={leadsOntem} /></div>
        <div className="card"><div className="label">Unread conversations</div><div className="value">{unread}</div><div className={unread ? "down" : "up"}>{contasComUnread ? `${contasComUnread} account(s) waiting${worstUnread ? `, worst: ${worstUnread.a.name} (${worstUnread.m.unread})` : ""}` : "nothing waiting"}</div></div>
        <div className="card"><div className="label">Open pipeline</div><div className="value">{money(oppValue)}</div><div className="hint">{oppCount} open opportunities{staleValue > 0 ? `, ${money(staleValue)} idle for 14+ days` : ""}</div></div>
        <div className="card"><div className="label">Fake leads quarantined</div><div className="value">{allFakes.length}</div><div className={allFakes.length ? "down" : "hint"}>{allFakes.length ? "kept out of the metrics" : "none in the last 30 days"}</div></div>
        <div className="card"><div className="label">Connected accounts</div><div className="value">{okMetrics.length}/{conectaveis.length}</div>{pendingTokens > 0 ? <div className="warn">{pendingTokens} waiting for token</div> : <div className="up">all locations connected</div>}</div>
      </div>

      <h2>Needs your attention</h2>
      {attention.length ? (
        <div className="queue">
          {attention.map((item, i) => (
            <div className={`qitem sev${item.severity}`} key={`${item.slug}-${i}`}>
              <div className="qbody">
                <div className="qhead"><b>{item.account}</b><span className="qproblem">{item.problem}</span></div>
                <div className="qproof">{item.proof}</div>
                <div className="qaction">→ {item.action}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="alert ok"><b>✓ All clear:</b> no queue is exploding, no lead source collapsed and no pipeline is stuck right now.</div>
      )}

      {changes.length > 0 && (
        <>
          <h2>What changed</h2>
          <div className="card changes">
            {changes.map((c, i) => (
              <div className="change" key={i}>
                <span className={c.tone === "good" ? "up" : c.tone === "bad" ? "down" : "hint"}>{c.tone === "good" ? "▲" : c.tone === "bad" ? "▼" : "●"}</span>
                <span>{c.text}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="chart">
        <div className="label" style={{ color: "#9FB2C3", fontSize: 12, textTransform: "uppercase", letterSpacing: .6 }}>Leads per day, 30 days vs previous 30 days</div>
        <svg viewBox="0 0 600 180" width="100%" height="150" preserveAspectRatio="none" style={{ marginTop: 10 }}>
          <polyline fill="none" stroke="#5B7186" strokeWidth="2" strokeDasharray="5 4" points={chartLine(seriesPrev30)} />
          <polyline fill="none" stroke="#EF4F18" strokeWidth="2.5" points={chartLine(series30)} />
        </svg>
        <div style={{ fontSize: 12, color: "#9FB2C3" }}><span style={{ color: "#EF4F18" }}>—</span> last 30 days <span style={{ color: "#5B7186" }}>- -</span> previous 30 days. The traffic line joins once GA4 is connected, to cross visits with leads and diagnose drops.</div>
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
                        <td><b>{a.name}</b><small className="note">{KIND_LABEL[a.kind]}{a.note ? `, ${a.note}` : ""}</small></td>
                        <td><span className={`dot ${h.level}`} title={h.reasons.join("; ")} /> <b>{h.label}</b><small className="note">{h.reasons[0]}</small></td>
                        <td><span className="cellnum">{m.leads7d}</span><br /><Delta cur={m.leads7d} prev={m.leadsPrev7d} />{vs && <small className="note">{vs}</small>}</td>
                        <td><Spark data={m.leadsByDay30} /></td>
                        <td>{m.unread > 0 ? <span className={m.unread >= 25 ? "down" : "warn"}>{m.unread}</span> : 0}</td>
                        <td>{money(m.opportunitiesValue)}<small className="note">{m.opportunitiesOpen} open{m.oppStaleValue > 0 ? `, ${money(m.oppStaleValue)} idle 14d+` : ""}</small></td>
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
          <div className="label">Drill-down{topAccount ? `, ${topAccount.a.name}, this week's leads` : ""}</div>
          {topAccount?.m.recentLeads.length ? (
            topAccount.m.recentLeads.map((l, i) => (
              <div className="lead" key={i}>
                <span>{l.name}<br /><small>{l.when}, {l.sourceLabel}</small></span>
                <span className={`tag${l.emailOnly ? " email" : ""}`}>{l.emailOnly ? "unverified" : "lead"}</span>
              </div>
            ))
          ) : (
            <p style={{ fontSize: 14, color: "#9FB2C3", marginTop: 8 }}>No leads in the last 7 days across the connected accounts.</p>
          )}
        </div>
        <div className="card">
          <div className="label">Fake leads quarantine, kept out of the metrics</div>
          {allFakes.length ? (
            allFakes.slice(0, 8).map((f, i) => (
              <div className="fake" key={i}>
                <span>{f.name}<br /><small>{f.account}, {f.reason}</small></span>
                <span className="tag email">fake</span>
              </div>
            ))
          ) : (
            <p style={{ fontSize: 14, color: "#9FB2C3", marginTop: 8 }}>No fakes detected in the last 30 days across the connected accounts. American Express, Verizon and Better Business Bureau are blocked by the name rule.</p>
          )}
        </div>
      </div>

      <h2>Roadmap</h2>
      <div className="card">
        <ul className="steps">
          <li><span className="done">✓</span> Dashboard live with the approved mockup design, GitHub and Vercel connected</li>
          <li><span className="done">✓</span> Live HighLevel collection on: named leads with source, unread conversations, opportunities, fakes excluded</li>
          <li><span className="done">✓</span> Decision layer on: attention queue ranked by money at risk, health score with reasons, 30-day trends, what-changed feed</li>
          <li><span className="todo">→</span> Tokens for the remaining accounts in Vercel, to complete all {conectaveis.length} HighLevel locations</li>
          <li><span className="todo">→</span> GA4 to cross site traffic with leads and diagnose drops</li>
          <li><span className="todo">→</span> Persisted daily snapshots and real per-account goals (leads/week, response time) to replace the portfolio-average context</li>
          <li><span className="todo">→</span> Lead-source mapping for clients without a location</li>
        </ul>
      </div>

      {notLive.length > 0 && (
        <details className="card notconnected">
          <summary>Not connected yet ({notLive.length})</summary>
          <div style={{ marginTop: 8 }}>
            {notLive.map((a) => (
              <div className="nc-row" key={a.slug}>
                <span><b>{a.name}</b>{a.note && <small className="note">{a.note}</small>}</span>
                <span className="nc-reason">{notConnectedReason(a)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="foot">Commander Center. Numbers read live from HighLevel on every load, with a 5-minute cache. Trends derived from contact and opportunity creation dates.</p>
    </div>
  );
}
