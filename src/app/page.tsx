import { ACCOUNTS, type Account } from "@/lib/accounts";
import { fetchAccountMetrics, type AccountMetrics } from "@/lib/hl";
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

function trend(m: AccountMetrics): { txt: string; cls: string } {
  if (m.leadsPrev7d === 0) return m.leads7d > 0 ? { txt: "new", cls: "up" } : { txt: "—", cls: "" };
  const pct = Math.round(((m.leads7d - m.leadsPrev7d) / m.leadsPrev7d) * 100);
  if (pct > 0) return { txt: `▲ ${pct}%`, cls: "up" };
  if (pct < 0) return { txt: `▼ ${Math.abs(pct)}%`, cls: "down" };
  return { txt: "flat", cls: "" };
}

function money(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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
  // stays out of the totals, the insights and the chart.
  const live = contas.filter((a) => metrics.get(a.slug)?.ok);
  const notLive = contas.filter((a) => !metrics.get(a.slug)?.ok);

  const okMetrics = [...metrics.values()].filter((m) => m.ok);
  const sum = (f: (m: AccountMetrics) => number) => okMetrics.reduce((s, m) => s + f(m), 0);

  const leads7d = sum((m) => m.leads7d);
  const leadsPrev = sum((m) => m.leadsPrev7d);
  const leadsHoje = sum((m) => m.leadsToday);
  const unread = sum((m) => m.unread);
  const contasComUnread = okMetrics.filter((m) => m.unread > 0).length;
  const oppValue = sum((m) => m.opportunitiesValue);
  const oppCount = sum((m) => m.opportunitiesOpen);
  const allFakes = okMetrics.flatMap((m) => m.fakes);
  const leadsByDay = Array(14).fill(0) as number[];
  okMetrics.forEach((m) => m.leadsByDay.forEach((v, i) => (leadsByDay[i] += v)));
  const maxDay = Math.max(1, ...leadsByDay);
  const chartPoints = leadsByDay.map((v, i) => `${Math.round((i / 13) * 600)},${Math.round(150 - (v / maxDay) * 120)}`).join(" ");

  const pendingTokens = conectaveis.length - ligadas.length;

  const topAccount = live
    .map((a) => ({ a, m: metrics.get(a.slug) }))
    .filter((x) => x.m?.ok)
    .sort((x, y) => (y.m!.leads7d - x.m!.leads7d))[0];
  const worstUnread = live
    .map((a) => ({ a, m: metrics.get(a.slug) }))
    .filter((x) => x.m?.ok && x.m.unread > 0)
    .sort((x, y) => (y.m!.unread - x.m!.unread))[0];
  const growth = live
    .map((a) => ({ a, m: metrics.get(a.slug) }))
    .filter((x) => x.m?.ok && x.m.leadsPrev7d > 0)
    .sort((x, y) => (y.m!.leads7d - y.m!.leadsPrev7d) / y.m!.leadsPrev7d - (x.m!.leads7d - x.m!.leadsPrev7d) / x.m!.leadsPrev7d)[0];

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
      <p className="sub">Overview, connected accounts only. Clean leads, fakes excluded. Updated {now}. {okMetrics.length} of {conectaveis.length} HighLevel locations are live.</p>

      <div className="kpis">
        <div className="card"><div className="label">New leads, 7d (clean)</div><div className="value">{leads7d}</div><div className={leads7d >= leadsPrev ? "up" : "down"}>{leadsPrev ? `vs ${leadsPrev} in the previous week` : "first reading"}</div></div>
        <div className="card"><div className="label">Leads today</div><div className="value">{leadsHoje}</div><div className="hint">across connected accounts</div></div>
        <div className="card"><div className="label">Unread conversations</div><div className="value">{unread}</div><div className={unread ? "down" : "up"}>{contasComUnread ? `${contasComUnread} account(s) waiting for a reply` : "nothing waiting"}</div></div>
        <div className="card"><div className="label">Open opportunities</div><div className="value">{money(oppValue)}</div><div className="hint">{oppCount} open opportunities</div></div>
        <div className="card"><div className="label">Fake leads quarantined</div><div className="value">{allFakes.length}</div><div className={allFakes.length ? "down" : "hint"}>{allFakes.length ? "kept out of the metrics" : "none in the last 30 days"}</div></div>
        <div className="card"><div className="label">Connected accounts</div><div className="value">{okMetrics.length}/{conectaveis.length}</div>{pendingTokens > 0 ? <div className="warn">{pendingTokens} waiting for token</div> : <div className="up">all locations connected</div>}</div>
      </div>

      {worstUnread && (
        <div className="alert"><b>⚠ Insight:</b> {worstUnread.a.name} has {worstUnread.m!.unread} unread conversation(s) waiting for a reply. It is the largest queue among the connected accounts.</div>
      )}
      {growth && growth.m!.leads7d !== growth.m!.leadsPrev7d && (
        <div className="alert ok"><b>✓ Insight:</b> {growth.a.name}: leads went from {growth.m!.leadsPrev7d} to {growth.m!.leads7d} this week. {growth.m!.leads7d > growth.m!.leadsPrev7d ? "Strong growth, worth checking what changed on the page and in the campaigns." : "It dropped, worth investigating the source before it becomes a trend."}</div>
      )}

      <div className="chart">
        <div className="label" style={{ color: "#9FB2C3", fontSize: 12, textTransform: "uppercase", letterSpacing: .6 }}>Leads per day, all connected accounts combined, 14 days</div>
        <svg viewBox="0 0 600 180" width="100%" height="150" preserveAspectRatio="none" style={{ marginTop: 10 }}>
          <polyline fill="none" stroke="#3DDC84" strokeWidth="2.5" points={chartPoints} />
        </svg>
        <div style={{ fontSize: 12, color: "#9FB2C3" }}><span style={{ color: "#3DDC84" }}>—</span> clean leads per day. The traffic line joins once GA4 is connected, to cross visits with leads and diagnose drops.</div>
      </div>

      {groups.map((g) => {
        const rows = live.filter((a) => g.kinds.includes(a.kind));
        if (rows.length === 0) return null;
        return (
          <section key={g.title}>
            <h2>{g.title}</h2>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr><th>Account</th><th>Type</th><th>Leads 7d</th><th>Unread</th><th>Opportunities</th><th>Trend</th><th></th></tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const m = metrics.get(a.slug)!;
                    return (
                      <tr key={a.slug}>
                        <td><b>{a.name}</b>{a.note && <small className="note">{a.note}</small>}</td>
                        <td>{KIND_LABEL[a.kind]}</td>
                        <td>{m.leads7d}</td>
                        <td>{m.unread}</td>
                        <td>{money(m.opportunitiesValue)}</td>
                        <td className={trend(m).cls}>{trend(m).txt}</td>
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
          {topAccount?.m?.recentLeads.length ? (
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
          <li><span className="todo">→</span> Tokens for the remaining accounts in Vercel, to complete all {conectaveis.length} HighLevel locations</li>
          <li><span className="todo">→</span> GA4 to cross site traffic with leads and diagnose drops</li>
          <li><span className="todo">→</span> History with daily snapshots and lead-source mapping for clients without a location</li>
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

      <p className="foot">Commander Center. Numbers read live from HighLevel on every load, with a 5-minute cache.</p>
    </div>
  );
}
