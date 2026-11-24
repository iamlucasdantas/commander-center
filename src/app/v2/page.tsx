import Link from "next/link";
import { ACCOUNTS, hasToken, notConnectedReason, type Account } from "@/lib/accounts";
import { fetchAllV2, fmtAge, hlLink, type V2AccountData } from "@/lib/v2data";
import {
  accountHealthV2, buildQueueV2, buildThreeLines, diagnosisFor, healthRank,
  type V2Data,
} from "@/lib/v2insights";
import { money, pctChange } from "@/lib/insights";
import { getState, stateConfigured, effectivePriority } from "@/lib/state";
import { getCommand } from "@/lib/command";
import { buildDay, chicagoDateStr, fmtTime } from "@/lib/agenda";
import { getV2State, queueItemVisible, type V2State } from "@/lib/v2state";
import ActionQueue from "@/components/v2/ActionQueue";
import AccountsTable, { type AccountRow } from "@/components/v2/AccountsTable";

export const dynamic = "force-dynamic";

type Period = "today" | "7d" | "30d";
type Segment = "all" | "clients" | "brands" | "community";

const SEGMENTS: Array<{ key: Segment; label: string }> = [
  { key: "all", label: "All" },
  { key: "clients", label: "Clients" },
  { key: "brands", label: "My brands" },
  { key: "community", label: "Community" },
];

function segmentOf(a: Account): Segment {
  if (a.kind === "cliente") return "clients";
  if (a.kind === "comunidade") return "community";
  return "brands";
}

function periodValues(d: V2AccountData, p: Period): { cur: number; prev: number } {
  if (p === "today") return { cur: d.contactsTodayV, prev: d.contactsYesterdayV };
  if (p === "30d") return { cur: d.contacts30dV, prev: d.contactsPrev30dV };
  return { cur: d.contacts7dV, prev: d.contactsPrev7dV };
}

const PERIOD_LABEL: Record<Period, string> = { today: "Today", "7d": "7d", "30d": "30d" };

export default async function Cockpit({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; segment?: string }>;
}) {
  const sp = await searchParams;
  const period: Period = sp.period === "today" || sp.period === "30d" ? sp.period : "7d";
  const segment: Segment = SEGMENTS.some((s) => s.key === sp.segment) ? (sp.segment as Segment) : "all";

  const contas = ACCOUNTS.filter((a) => a.kind !== "potencial");
  const conectaveis = contas.filter((a) => a.sourceStatus === "hl-location");
  const data0 = await fetchAllV2(contas);
  const bySlug = new Map(data0.map((d) => [d.slug, d]));
  const live: V2Data[] = contas
    .filter((a) => bySlug.has(a.slug))
    .map((a) => ({ a, d: bySlug.get(a.slug)! }));
  const notLive = contas.filter((a) => !bySlug.has(a.slug));

  const sum = (f: (d: V2AccountData) => number) => live.reduce((s, x) => s + f(x.d), 0);
  const totalWaiting = sum((d) => d.waitingCount);
  const idleTotal = sum((d) => d.idleValue);
  const idleAccounts = live.filter((x) => x.d.idleValue > 0).length;
  const fakeTotal = sum((d) => d.fakeCount30d);
  const periodTotal = live.reduce((s, x) => s + periodValues(x.d, period).cur, 0);
  const periodPrev = live.reduce((s, x) => s + periodValues(x.d, period).prev, 0);
  const periodDelta = pctChange(periodTotal, periodPrev);
  const topShare = live
    .map((x) => ({ name: x.a.name, v: periodValues(x.d, period).cur }))
    .sort((a, b) => b.v - a.v)[0];
  const concentration = periodTotal > 0 && topShare && topShare.v / periodTotal > 0.4
    ? { name: topShare.name, share: Math.round((topShare.v / periodTotal) * 100) }
    : null;
  const worstWaiting = [...live].filter((x) => x.d.waitingCount > 0).sort((a, b) => b.d.waitingCount - a.d.waitingCount)[0];
  const topIdle = [...live].sort((a, b) => b.d.idleValue - a.d.idleValue)[0];
  const topFakes = [...live].sort((a, b) => b.d.fakeCount30d - a.d.fakeCount30d)[0];

  const lines = buildThreeLines(live);

  // Action queue: construída no servidor, filtrada pelas marcas
  // (Snooze/Done) e pelo segmento escolhido.
  const v2state: V2State = await getV2State(0).catch(() => ({ queue: {} }));
  const queueAll = buildQueueV2(live, (slug, area) => {
    const acc = contas.find((x) => x.slug === slug);
    return area === "dashboard" || !acc?.locationId
      ? `/v2/account/${slug}`
      : hlLink(acc.locationId, area);
  });
  const queue = queueAll.filter(
    (item) =>
      queueItemVisible(v2state.queue[item.key], item.signature) &&
      (segment === "all" || segmentOf(contas.find((x) => x.slug === item.slug)!) === segment),
  );

  // Coluna direita: agenda de hoje, P1 e Agency business.
  const command = await getCommand();
  const nowDate = new Date();
  const todayItems = command.agenda
    ? buildDay(command.agenda, chicagoDateStr(nowDate)).items
        .filter((i) => i.allDay || new Date(i.end).getTime() > nowDate.getTime())
        .slice(0, 5)
    : [];
  const panelState = stateConfigured() ? await getState(0).catch(() => null) : null;
  const openP1 = (panelState?.tasks ?? [])
    .filter((t) => t.status === "open" && effectivePriority(t) === 1)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  // Tabela de contas (segmento filtra a tabela e a fila; os KPIs de
  // topo são do portfólio inteiro, como a spec pede).
  const rows: AccountRow[] = live
    .filter((x) => segment === "all" || segmentOf(x.a) === segment)
    .map(({ a, d }) => {
      const h = accountHealthV2(d);
      const pv = periodValues(d, period);
      return {
        slug: a.slug,
        name: a.name,
        segment: a.kind === "cliente" ? "Clients" : a.kind === "comunidade" ? "Community" : "My brands",
        segmentKey: segmentOf(a),
        healthLevel: h.level,
        healthLabel: h.label,
        healthReason: h.reason,
        contacts: pv.cur,
        contactsDelta: pctChange(pv.cur, pv.prev),
        waiting: d.waitingCount,
        waitingOldestMin: d.waitingOldestMin,
        idleValue: d.idleValue,
        idleCount: d.idleCount,
        openValue: d.opportunitiesValue,
        openCount: d.opportunitiesOpen,
        won30Value: d.won30Value,
        won30Count: d.won30Count,
        fakeCount: d.fakeCount30d,
        risk: healthRank(h.level) * 1_000_000_000 + d.idleValue + d.waitingCount * 1000 + (d.waitingOldestMin ?? 0),
        diagnosis: diagnosisFor(d),
        hlDashboard: hlLink(a.locationId, "dashboard"),
      };
    });

  const chipHref = (s: Segment) => {
    const p = new URLSearchParams();
    if (period !== "7d") p.set("period", period);
    if (s !== "all") p.set("segment", s);
    const qs = p.toString();
    return `/v2${qs ? `?${qs}` : ""}`;
  };

  return (
    <div>
      <p className="sub" style={{ marginBottom: 16 }}>
        {live.length} of {conectaveis.length} locations live · verified contacts only in the top numbers · Chicago time
      </p>

      <h2 style={{ marginTop: 0 }}>This week in 3 lines</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="v2-lines">
          {lines.map((l, i) => (
            <div className="v2-line" key={i}><span className="n">{i + 1}</span><span>{l}</span></div>
          ))}
        </div>
      </div>

      <div className="kpis v2-kpis">
        <Link href="/v2/waiting" className="card" style={{ textDecoration: "none", color: "inherit" }}
          title="Source: HighLevel conversations, verified leads only. Waiting = the last message is the client's.">
          <div className="label">Waiting for reply</div>
          <div className="value">{totalWaiting}</div>
          <div className={totalWaiting ? "down" : "up"}>
            {worstWaiting ? `worst: ${worstWaiting.a.name} (${worstWaiting.d.waitingCount})` : "nothing waiting"}
          </div>
          {worstWaiting?.d.waitingOldestMin !== null && worstWaiting && (
            <div className="hint" style={{ marginTop: 4 }}>oldest wait {fmtAge(worstWaiting.d.waitingOldestMin!)}</div>
          )}
        </Link>

        <Link href={topIdle && topIdle.d.idleValue > 0 ? `/v2/account/${topIdle.a.slug}` : "/v2#accounts"} className="card" style={{ textDecoration: "none", color: "inherit" }}
          title="Source: HighLevel opportunities, open and unchanged for 14+ days.">
          <div className="label">Idle pipeline · 14d+</div>
          <div className="value">{money(idleTotal)}</div>
          <div className="hint">{idleAccounts} account{idleAccounts === 1 ? "" : "s"} with money sitting still</div>
        </Link>

        <Link href="/v2#accounts" className="card" style={{ textDecoration: "none", color: "inherit" }}
          title="Source: HighLevel contacts, verified only (stray email and imports excluded).">
          <div className="label">Contacts · {PERIOD_LABEL[period]} · verified</div>
          <div className="value">{periodTotal}</div>
          {periodDelta !== null ? (
            <div className={periodDelta > 0 ? "up" : periodDelta < 0 ? "down" : "hint"}>
              {periodDelta > 0 ? "▲" : periodDelta < 0 ? "▼" : ""} {Math.abs(periodDelta)}% vs previous period
            </div>
          ) : (
            <div className="hint">no baseline yet</div>
          )}
          {concentration && (
            <div className="warn" style={{ marginTop: 4 }}>
              Concentration alert: {concentration.name} is {concentration.share}% of the total
            </div>
          )}
        </Link>

        <div className="v2-connect" title="Not connected: the conversations messages endpoint answers 401 with the current HighLevel key scopes.">
          <div className="label">Speed to lead</div>
          <div className="big">CONNECT</div>
          <p>Median time to the first reply. Needs the messages scope on the HighLevel keys; the endpoint answers 401 today, so no number is shown.</p>
        </div>

        <div className="v2-connect" title="Not connected: the HighLevel keys have no calendars scope.">
          <div className="label">Booked · {PERIOD_LABEL[period]}</div>
          <div className="big">CONNECT</div>
          <p>Appointments created in the period. Needs the calendars scope on the HighLevel keys, so no number is shown.</p>
        </div>

        <Link href={topFakes && topFakes.d.fakeCount30d > 0 ? `/v2/account/${topFakes.a.slug}` : "/v2#accounts"} className="card" style={{ textDecoration: "none", color: "inherit" }}
          title="Source: HighLevel contacts matching the fake patterns, last 30 days. Kept out of every metric.">
          <div className="label">Fakes quarantined · 30d</div>
          <div className="value">{fakeTotal}</div>
          <div className="hint">kept out of the metrics</div>
        </Link>
      </div>

      <div className="v2-cockpit" style={{ marginTop: 18 }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Action queue</h2>
          <ActionQueue initialItems={queue} />
        </div>
        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <div className="card">
            <div className="label">Today · Agenda</div>
            {todayItems.length ? (
              <>
                <div style={{ marginTop: 6 }}>
                  {todayItems.map((i) => (
                    <div className="rowline" key={i.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: "1px solid #241D19", fontSize: 13.5 }}>
                      <span>{i.title}<small style={{ color: "#B7A69B", display: "block", fontSize: 12 }}>{i.kind === "content" ? "Protected block" : i.kind === "ritual" ? "Weekly ritual" : i.calendar ?? ""}</small></span>
                      <b>{i.allDay ? "All day" : fmtTime(i.start)}</b>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10 }}>
                  <Link href="/agenda" style={{ color: "#F0772E", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>Open the Agenda →</Link>
                </div>
              </>
            ) : (
              <p style={{ fontSize: 14, color: "#B7A69B", marginTop: 8 }}>
                {command.agenda ? "Nothing left on today's agenda." : "No agenda snapshot yet. The daily collector fills this in."}
              </p>
            )}
          </div>

          <div className="card">
            <div className="label">Priority P1 · open</div>
            <div className="value">{openP1.length}</div>
            {openP1.length ? (
              <>
                {openP1.slice(0, 4).map((t) => (
                  <div key={t.id} style={{ padding: "6px 0", borderBottom: "1px solid #241D19", fontSize: 13.5 }}>
                    {t.title}
                    {t.project ? <small style={{ color: "#B7A69B", display: "block", fontSize: 12 }}>{t.project}</small> : null}
                  </div>
                ))}
                <div style={{ marginTop: 10 }}>
                  <Link href="/priorities" style={{ color: "#F0772E", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>Open Priorities →</Link>
                </div>
              </>
            ) : (
              <div className="hint">nothing in P1 right now</div>
            )}
          </div>

          <div className="card">
            <div className="label">Agency business</div>
            <div className="value">{live.length}<span style={{ fontSize: 17, color: "#B7A69B" }}> / {conectaveis.length}</span></div>
            <div className="hint">locations live and collecting</div>
            <p style={{ fontSize: 12.5, color: "#FFD97C", marginTop: 10 }}>
              MRR: connect. Stripe is not wired into the panel yet.
            </p>
            <div style={{ marginTop: 8 }}>
              <Link href="/v2/agency" style={{ color: "#F0772E", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>Open Agency business →</Link>
            </div>
          </div>
        </div>
      </div>

      <h2 id="accounts">Accounts</h2>
      <div className="v2-chips">
        {SEGMENTS.map((s) => (
          <Link key={s.key} href={chipHref(s.key)} className={`v2-chip${segment === s.key ? " on" : ""}`}>
            {s.label}
          </Link>
        ))}
        <span className="hint" style={{ alignSelf: "center" }}>Segment filters the queue and this table. Click a row for the account drawer.</span>
      </div>
      <AccountsTable rows={rows} periodLabel={PERIOD_LABEL[period]} />

      {notLive.length > 0 && (
        <details className="card notconnected">
          <summary>Not connected yet ({notLive.length})</summary>
          <div style={{ marginTop: 8 }}>
            {notLive.map((a) => (
              <div className="nc-row" key={a.slug}>
                <span><b><Link className="acctlink" href={`/v2/account/${a.slug}`}>{a.name}</Link></b>{a.note && <small className="note">{a.note}</small>}</span>
                <span className="nc-reason">{notConnectedReason(a)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="foot">Commander Center 2.0 preview · Sources: HighLevel contacts, conversations and opportunities (5-minute cache), panel snapshots for agenda and priorities. Every number carries its source in the tooltip.</p>
    </div>
  );
}
