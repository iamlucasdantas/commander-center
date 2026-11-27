import Link from "next/link";
import { notFound } from "next/navigation";
import { ACCOUNTS, SITE_SOURCES, notConnectedReason } from "@/lib/accounts";
import { fetchV2Account, fmtAge, hlLink } from "@/lib/v2data";
import {
  accountHealthV2, diagnosisFor, buildFunnel, fmtConv, doNextFor, suggestedMove,
  V2_HEALTH_COLOR, type FunnelStage,
} from "@/lib/v2insights";
import { money } from "@/lib/insights";
import { SERVICE_CONFIG } from "@/lib/services";
import { getAnalytics } from "@/lib/analytics";
import { fetchAccountDetail, type AccountDetail, type CallSummary } from "@/lib/hl";
import { getState, stateConfigured } from "@/lib/state";
import { groupLogEntries } from "@/lib/v2log";
import LeadList from "@/components/LeadList";
import GroupedLog from "@/components/v2/GroupedLog";
import SuggestionsSection from "@/components/SuggestionsSection";
import { Delta, Pie, PIE_COLORS, Spark, TZ } from "@/components/viz";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "contacts", label: "Contacts" },
  { key: "website", label: "Website & Google" },
  { key: "log", label: "Log" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/**
 * Página da conta no /v2, COMPLETA (spec seção 4, etapa 4):
 * cabeçalho, frase de diagnóstico por regra e as quatro abas.
 *   - Overview: o funil "From Google to a booked job" (cada etapa
 *     com a fonte no tooltip e a conversão para a próxima; Booked
 *     entra como CONNECT porque as chaves não têm o escopo de
 *     calendários), os cards de decisão, "Do next" por regra, a
 *     lista de espera, as top oportunidades e os Setup gaps como
 *     checklist com a correção nomeada.
 *   - Contacts: a MESMA lista da versão atual (LeadList com filtro
 *     All, Verified, Unverified, verificação manual seletiva interna
 *     e exclusão de não verificados), sem regra nova.
 *   - Website & Google: GA4 e Search Console do snapshot diário,
 *     com a coluna "Suggested move" gerada por regra declarada.
 *   - Log: o log agrupado filtrado por esta conta.
 * A página completa da versão atual continua em /account/[slug].
 */
export default async function V2AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "overview";
  const a = ACCOUNTS.find((x) => x.slug === slug);
  if (!a) notFound();

  const cfg = SERVICE_CONFIG[slug];
  const analytics = await getAnalytics();
  const snap = analytics.sites[slug];
  // Avaliações do Google (Google Business Profile), quando o coletor
  // de reputação já gravou um snapshot desta conta (2026-11-25).
  const rep = analytics.reputation?.[slug];
  const back = <Link href="/v2#accounts" className="backlink">← All accounts</Link>;

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

  // Dados pesados só são buscados na aba que os usa (a página abre
  // rápido e o cache de 5 minutos da coleta é compartilhado). A
  // Overview também busca quando a conta tem bloco de ligações
  // (showCalls): é de lá que sai o resumo de chamadas do Voice AI.
  let detail: AccountDetail | null = null;
  let detailFailed = false;
  if (tab === "contacts" || (tab === "overview" && (cfg?.showCalls || cfg?.showWon || cfg?.stagesPipeline))) {
    try {
      detail = await fetchAccountDetail(a);
    } catch {
      detailFailed = true;
    }
  }
  const accountLog = tab === "log" && stateConfigured()
    ? (await getState(0)).log.filter((e) => e.slug === slug)
    : [];
  // Sugestões dos agentes deste cliente (2026-11-26): PRIMEIRO bloco
  // da página, acima das abas e dos KPIs, em qualquer aba.
  const suggestions = stateConfigured()
    ? (await getState(0)).suggestions.filter((e) => e.slug === slug)
    : [];

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

      <SuggestionsSection initial={suggestions} />

      <nav className="v2-tabs" aria-label="Account sections">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "overview" ? `/v2/account/${slug}` : `/v2/account/${slug}?tab=${t.key}`}
            className={`v2-tab${tab === t.key ? " on" : ""}`}
            aria-current={tab === t.key ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <OverviewTab slug={slug} d={d} snap={snap} stripeLive={Boolean(analytics.stripe?.accounts.length)} repLive={Boolean(rep && !rep.error)} calls={detail?.calls ?? null} detail={detail} />
      )}

      {tab === "contacts" && (
        <div>
          <h2>New leads this week{detail ? ` · ${detail.weekLeads.length}` : ""}</h2>
          <div className="card">
            {detailFailed ? (
              <p style={{ fontSize: 14, color: "#B7A69B" }}>
                The lead list could not be loaded just now. Use the global Refresh in the top bar, or open the
                list on the current version&apos;s account page.
              </p>
            ) : detail ? (
              <LeadList leads={detail.weekLeads} deleteSlug={slug} verifySlug={slug} emptyText="No new leads in the last 7 days." />
            ) : null}
          </div>
          {detail && (detail.metrics.fakeCount30d > 0 || detail.partnerTotal > 0) && (
            <p className="foot">
              {detail.metrics.fakeCount30d > 0 && (
                <>{detail.metrics.fakeCount30d} fake{detail.metrics.fakeCount30d === 1 ? "" : "s"} quarantined in the last 30 days, kept out of every metric. </>
              )}
              {detail.partnerTotal > 0 && (
                <>{detail.partnerTotal} Partner $1 buyers hidden from this account&apos;s lists. </>
              )}
              The full quarantine lives on the{" "}
              <Link href={`/account/${slug}`} style={{ color: "#F0772E", fontWeight: 600 }}>current version&apos;s account page</Link>.
            </p>
          )}
        </div>
      )}

      {tab === "website" && <WebsiteTab slug={slug} snap={snap} rep={rep} />}

      {tab === "log" && (
        <div>
          <h2>Account log</h2>
          <p className="sub">
            {accountLog.length} entries for this account, grouped by action, minute and run · names live in the details ·
            read-only grouping, nothing was deleted or rewritten
          </p>
          <div className="card">
            <GroupedLog groups={groupLogEntries(accountLog)} />
          </div>
          <p className="foot">
            Manual entries are added from the{" "}
            <Link href={`/account/${slug}`} style={{ color: "#F0772E", fontWeight: 600 }}>current version&apos;s account page</Link>{" "}
            (Log &amp; tasks), the same as before.
          </p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- Overview

function OverviewTab({
  slug, d, snap, stripeLive, repLive, calls, detail,
}: {
  slug: string;
  d: Awaited<ReturnType<typeof fetchV2Account>>;
  snap?: import("@/lib/analytics").SiteSnapshot;
  stripeLive: boolean;
  repLive: boolean;
  calls: CallSummary | null;
  detail: AccountDetail | null;
}) {
  const a = ACCOUNTS.find((x) => x.slug === slug)!;
  const cfg = SERVICE_CONFIG[slug];
  const funnel = buildFunnel(d, snap ?? null);
  const next = doNextFor(a, d, (area) => hlLink(a.locationId, area), snap?.gsc ?? null);
  // Os gaps de MRR do mapa de serviços nasceram antes do Stripe
  // entrar no painel (etapa 5): com snapshot vivo, o gap vira ponteiro.
  const gaps = (cfg?.pendencies ?? []).map((p) =>
    stripeLive && p.startsWith("MRR is not in the panel yet")
      ? "MRR now lives on the Agency business page, from the daily Stripe snapshot."
      : repLive && p.startsWith("Google reviews are not measurable yet")
        ? "Google reviews now live in the Website & Google tab, from the daily Google Business Profile snapshot."
        : p,
  );

  return (
    <div>
      <h2>From Google to a booked job</h2>
      <div className="card">
        <Funnel stages={funnel} wonCount={d.won30Count} />
        <p className="hint" style={{ marginTop: 10 }}>
          Every number carries its source in the tooltip. Google and site stages use the collector&apos;s 28-day
          snapshot; HighLevel stages use the panel&apos;s own windows, named in each tooltip.
        </p>
      </div>

      <div className="kpis v2-kpis">
        <div className="card" title="Source: HighLevel conversations, verified leads only.">
          <div className="label">Waiting for reply</div>
          <div className="value">{d.waitingCount}</div>
          <div className="hint">{d.waitingOldestMin !== null ? `oldest wait ${fmtAge(d.waitingOldestMin)}` : "nothing waiting"}</div>
        </div>
        <div className="v2-connect" title="Not connected: the conversations messages endpoint answers 401 with the current key scopes.">
          <div className="label">Speed to lead</div>
          <div className="big">CONNECT</div>
          <p>{cfg?.speedToLeadNote ?? "Needs the messages scope on this account's HighLevel key."}</p>
        </div>
        <div className="v2-connect" title="Not connected: call detail needs the same messages scope; the conversations endpoint answers 401 today.">
          <div className="label">Missed calls</div>
          <div className="big">CONNECT</div>
          <p>{cfg?.missedCallsNote ?? "Needs the call detail scope on this account's HighLevel key."}</p>
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

      {cfg?.showCalls && (
        <>
          <h2>Voice AI{cfg.callAgent ? ` · ${cfg.callAgent}` : ""}</h2>
          <div className="card" title="Source: HighLevel conversations, recent window (100 most recent merged with the 100 most recent phone conversations). Same count as the contracted service block on the current version's account page.">
            {calls ? (
              <div className="kpis" style={{ marginTop: 4 }}>
                <div>
                  <div className="label">Call conversations</div>
                  <div className="value">{calls.callConversations}</div>
                  <div className="hint">of {calls.windowSize} conversations in the window</div>
                </div>
                <div>
                  <div className="label">Inbound / outbound</div>
                  <div className="value">{calls.inbound} / {calls.outbound}</div>
                  <div className="hint">by the last message direction</div>
                </div>
                <div>
                  <div className="label">Active · 7 days</div>
                  <div className="value">{calls.activity7d}</div>
                  <div className="hint">{calls.activity30d} active in 30 days</div>
                </div>
                <div>
                  <div className="label">Last activity was the call</div>
                  <div className="value">{calls.lastWasCall}</div>
                  <div className="hint">the rest continued by message</div>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: 14, color: "#B7A69B" }}>
                The conversation search did not answer in this load, so the call count is not shown.
              </p>
            )}
          </div>
          {calls && (calls.types !== null || calls.weekItems.length > 0) && (
            <div className="card" style={{ marginTop: 14 }} title="Source: the post-call workflow fields recorded on each contact in HighLevel (Call Category, Reason For Call, Service of Interest, Lead Temperature, Urgent Flag), read on the most recent call conversations. Call content and duration are not read: this account is HIPAA in HighLevel and the messages API answers 401.">
              <div style={{ display: "flex", gap: 26, flexWrap: "wrap" }}>
                {calls.types !== null && calls.typesRead > 0 && (() => {
                  const slices: { label: string; value: number; color?: string }[] = [
                    ...calls.types.map((t) => ({ label: t.category, value: t.count })),
                    ...(calls.typesRead - calls.categorized > 0
                      ? [{ label: "Not recorded", value: calls.typesRead - calls.categorized, color: "#4A3F39" }]
                      : []),
                  ];
                  const total = slices.reduce((sum, x) => sum + x.value, 0);
                  return (
                    <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
                      <Pie slices={slices} centerTop={String(total)} centerBottom="calls read" />
                      <div>
                        <div className="label" style={{ marginBottom: 8 }}>Call types · last {calls.typesRead} calls</div>
                        {slices.map((sl, i) => (
                          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, marginBottom: 4 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 3, background: sl.color ?? PIE_COLORS[i % PIE_COLORS.length], flex: "none" }} />
                            <span>{sl.label}</span>
                            <b>{sl.value}</b>
                            <span className="hint">{total > 0 ? `${Math.round((sl.value / total) * 100)}%` : ""}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {(() => {
                  const g = agentGrade(calls);
                  if (!g) return null;
                  return (
                    <div style={{ minWidth: 190 }}>
                      <div className="label">Agent grade</div>
                      <div className="value" style={{ fontSize: 34 }}>{g.letter} <span style={{ fontSize: 17, color: "#B7A69B" }}>· {g.score}/100</span></div>
                      <div className="hint" style={{ maxWidth: 250, lineHeight: 1.5 }}>
                        Triage grade: {Math.round(g.coverage * 100)}% of the calls read have a category recorded
                        {g.reasonRate !== null ? <> and {Math.round(g.reasonRate * 100)}% of this week&apos;s calls have the reason recorded</> : null}.
                        Call content and duration cannot be read in this HIPAA account, so the grade measures how completely each call was triaged and logged, not the conversation itself.
                      </div>
                    </div>
                  );
                })()}
              </div>
              {calls.weekItems.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div className="label" style={{ marginBottom: 6 }}>
                    This week on calls · {calls.weekItems.length}
                    {(() => {
                      const urg = calls.weekItems.filter((w) => w.urgent && !/^(no|false|none)$/i.test(w.urgent.trim())).length;
                      const hot = calls.weekItems.filter((w) => /hot|quente/i.test(w.temperature ?? "")).length;
                      const nocat = calls.weekItems.filter((w) => !w.category).length;
                      const bits = [
                        urg > 0 ? `${urg} flagged urgent` : null,
                        hot > 0 ? `${hot} hot lead${hot === 1 ? "" : "s"}` : null,
                        nocat > 0 ? `${nocat} without a category recorded` : null,
                      ].filter(Boolean);
                      return bits.length > 0 ? <span style={{ color: "#FFD97C" }}> · {bits.join(" · ")}</span> : null;
                    })()}
                  </div>
                  {[...calls.weekItems].sort((x, y) => y.when - x.when).slice(0, 10).map((w, i) => (
                    <div className="conv" key={`${w.contactName}-${i}`}>
                      <span>
                        <b>{w.contactName}</b>
                        {w.category ? <span style={{ color: "#F0772E", fontWeight: 700 }}> · {w.category}</span> : null}
                        {w.reason ? <span style={{ color: "#B7A69B" }}> · {w.reason}</span> : null}
                        {w.service ? <span className="preview">{w.service}</span> : null}
                      </span>
                      <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flex: "none" }}>
                        {w.temperature ? <span className="hint" style={{ fontWeight: 700, color: /hot|quente/i.test(w.temperature) ? "#FF6B6B" : undefined }}>{w.temperature}</span> : null}
                        {w.urgent && !/^(no|false|none)$/i.test(w.urgent.trim()) ? <span style={{ color: "#FF6B6B", fontWeight: 800, fontSize: 12.5 }}>URGENT</span> : null}
                        <span className="hint">{w.when > 0 ? new Date(w.when).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ }) : ""}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {(cfg?.showWon || cfg?.stagesPipeline) && detail && (
        <>
          <h2>Contracted service · {cfg.title}</h2>
          <div className="card" title="Source: HighLevel opportunities read by the panel (same loaded window as the current version's account page).">
            <div className="label">{cfg.kpiLabel}</div>
            {cfg.note && <p className="hint" style={{ marginTop: 8, maxWidth: 720 }}>{cfg.note}</p>}
            {cfg.showWon && detail.won && (
              <div className="kpis" style={{ marginTop: 14 }}>
                <div>
                  <div className="label">Won · loaded window</div>
                  <div className="value">{detail.won.count}</div>
                  <div className="hint">{money(detail.won.value)} total value</div>
                </div>
                <div>
                  <div className="label">Won · last 30 days</div>
                  <div className="value">{detail.won.last30Count}</div>
                  <div className="hint">{money(detail.won.last30Value)}</div>
                </div>
                <div>
                  <div className="label">Lost · loaded window</div>
                  <div className="value">{detail.won.lostCount}</div>
                  <div className="hint">in the same window</div>
                </div>
              </div>
            )}
            {(() => {
              const group = cfg.stagesPipeline
                ? detail.stageGroups.find((g) => g.pipeline.toLowerCase().includes(cfg.stagesPipeline!.toLowerCase()))
                : undefined;
              if (!group || group.stages.length === 0) return null;
              const maxStage = Math.max(1, ...group.stages.map((s) => s.count));
              return (
                <div style={{ marginTop: 16 }}>
                  <div className="label">Open by stage · {group.pipeline}</div>
                  <div style={{ marginTop: 6 }}>
                    {group.stages.map((s) => (
                      <div className="conv" key={s.name}>
                        <span>{s.name}</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                          <span className="minibar" style={{ width: 110, marginTop: 0 }}>
                            <i style={{ width: `${Math.max(2, Math.round((s.count / maxStage) * 100))}%` }} />
                          </span>
                          <b>{s.count}</b>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </>
      )}

      <h2>Do next</h2>
      <div className="card">
        {next.map((n, i) => (
          <div className="v2-next" key={i}>
            <span className="n">{i + 1}</span>
            <span style={{ fontSize: 14.5, lineHeight: 1.55 }}>{n.text}</span>
            {n.external ? (
              <a className="btn mini" style={{ textDecoration: "none", flex: "none" }} href={n.href} target="_blank" rel="noreferrer">Open</a>
            ) : (
              <Link className="btn mini" style={{ textDecoration: "none", flex: "none" }} href={n.href}>Open</Link>
            )}
          </div>
        ))}
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

      {gaps.length > 0 && (
        <>
          <h2>Setup gaps</h2>
          <div className="card">
            {gaps.map((p, i) => (
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
      </p>
    </div>
  );
}

/** Funil em etapas: número grande, fonte no tooltip, conversão entre etapas. */
function Funnel({ stages, wonCount }: { stages: FunnelStage[]; wonCount: number }) {
  // Escala das barras: contagens das etapas (o Won entra pela
  // contagem de oportunidades, porque o valor dele é dinheiro).
  const barOf = (s: FunnelStage): number | null =>
    s.key === "won" ? wonCount : s.value;
  const counts = stages.map(barOf).filter((v): v is number => v !== null && v > 0);
  const max = counts.length ? Math.max(...counts) : 0;

  return (
    <div>
      {stages.map((s, i) => {
        const bv = barOf(s);
        const width = bv !== null && max > 0 && bv > 0
          ? Math.max(3, Math.round((Math.sqrt(bv) / Math.sqrt(max)) * 100))
          : 0;
        return (
          <div key={s.key}>
            {i > 0 && (
              <div className="v2-fconv" title={stages[i - 1].missing || s.missing ? "Conversion not shown: one of the two stages is not connected." : undefined}>
                {s.missing || stages[i - 1].missing
                  ? "↓ not connected"
                  : `↓ ${fmtConv(s.convFromPrev)} of the stage above`}
              </div>
            )}
            {s.missing ? (
              <div className="v2-fstage v2-fconnect" title={s.source}>
                <span className="v2-flabel">{s.label}</span>
                <span className="v2-fbig">CONNECT</span>
                <span className="v2-fmissing">{s.missing}</span>
              </div>
            ) : (
              <div className="v2-fstage" title={s.source}>
                <span className="v2-flabel">{s.label}</span>
                <span className="v2-fvalue">{s.display}</span>
                {s.sub && <span className="v2-fsub">{s.sub}</span>}
                <span className="v2-fbar"><i style={{ width: `${width}%` }} /></span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------ Website & Google

function WebsiteTab({
  slug, snap, rep,
}: {
  slug: string;
  snap?: import("@/lib/analytics").SiteSnapshot;
  rep?: import("@/lib/reputation").ReputationSnapshot;
}) {
  const reviews = rep ? <ReviewsCard rep={rep} /> : null;
  const src = SITE_SOURCES[slug];
  const hasSource = Boolean(src && ((src.ga4?.length ?? 0) > 0 || (src.gsc?.length ?? 0) > 0));
  const ga4 = snap?.ga4;
  const gsc = snap?.gsc;
  const direct = ga4?.channels.find((c) => c.name.toLowerCase() === "direct");
  const directShare = direct && ga4 && ga4.sessions28 > 0 ? direct.sessions / ga4.sessions28 : 0;

  if (!hasSource) {
    return (
      <div>
      {reviews}
      <div className="card">
        <div className="label">No analytics source</div>
        <p style={{ fontSize: 14, color: "#B7A69B", marginTop: 8 }}>
          No analytics source is connected for this account&apos;s site yet: no GA4 property and no
          Search Console site were found in the connected accounts. Nothing is estimated here.
        </p>
      </div>
      </div>
    );
  }
  if (!snap) {
    return (
      <div>
      {reviews}
      <div className="card">
        <div className="label">Waiting for the first snapshot</div>
        <p style={{ fontSize: 14, color: "#B7A69B", marginTop: 8 }}>
          A source exists for this site, but the daily collector has not delivered a snapshot yet.
        </p>
      </div>
      </div>
    );
  }

  return (
    <div>
      {reviews}
      {ga4 && (
        <>
          <h2>Google Analytics · last 28 days{ga4.properties > 1 ? ` · ${ga4.properties} properties summed` : ""}</h2>
          <div className="card">
            {!ga4.hasData ? (
              <p style={{ fontSize: 14, color: "#B7A69B" }}>
                GA4 connected, no data in the period: the property answered, but recorded no sessions
                in the last 28 days.
              </p>
            ) : (
              <>
                <div className="kpis" style={{ marginTop: 4 }}>
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
                {directShare > 0.8 && ga4.sessions28 >= 50 && (
                  <p className="hint" style={{ marginTop: 10, color: "#FFD97C" }}>
                    Direct is {Math.round(directShare * 100)}% of sessions: check for internal or bot traffic
                    (and filter internal IPs in GA4) before trusting this total.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}

      {gsc && (
        <>
          <h2>Google Search Console · last 28 days{gsc.sites > 1 ? ` · ${gsc.sites} sites summed` : ""}</h2>
          <div className="card">
            <div className="kpis" style={{ marginTop: 4 }}>
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
              <div className="v2-tablewrap" style={{ marginTop: 14 }}>
                <table className="v2-qtable">
                  <thead>
                    <tr>
                      <th>Top searches</th>
                      <th>Clicks</th>
                      <th>Impressions</th>
                      <th>CTR</th>
                      <th>Position</th>
                      <th>Suggested move</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gsc.topQueries.map((q) => (
                      <tr key={q.query}>
                        <td><b>{q.query}</b></td>
                        <td>{q.clicks.toLocaleString("en-US")}</td>
                        <td>{q.impressions.toLocaleString("en-US")}</td>
                        <td>{q.impressions > 0 ? `${((q.clicks / q.impressions) * 100).toFixed(1)}%` : "—"}</td>
                        <td>{q.position.toFixed(1)}</td>
                        <td className="v2-move">{suggestedMove(q)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="hint" style={{ marginTop: 12 }}>
              Suggested moves come from a fixed rule over each query&apos;s own numbers (position 11 to 20 with
              weak clicks asks for title and internal links; many impressions with 0 clicks asks for a title
              that matches the intent). No AI, no promise, just the reading of the number.
            </p>
          </div>
        </>
      )}

      <p className="hint" style={{ marginTop: 12 }}>
        Snapshot collected {new Date(snap.collectedAt).toLocaleString("en-US", {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ,
        })} (Chicago) by the daily collector from the connected Google accounts. Search Console data lags about 3 days.
      </p>
    </div>
  );
}

// --------------------------------------------------------- Voice AI grade

/**
 * Nota geral do agente de voz, SÓ com o que dá pra medir sem ler a
 * conversa: a completude da triagem gravada pelo workflow pós-ligação
 * (categoria nas ligações lidas + motivo nas ligações da semana).
 * Em conta HIPAA o conteúdo e a duração da ligação não são legíveis
 * (mensagens 401), então a nota mede triagem e registro, nunca a
 * conversa. A receita aparece ao lado da nota no painel.
 */
function agentGrade(calls: CallSummary): { score: number; letter: string; coverage: number; reasonRate: number | null } | null {
  if (calls.typesRead === 0) return null;
  const coverage = calls.categorized / calls.typesRead;
  const wk = calls.weekItems;
  const reasonRate = wk.length > 0 ? wk.filter((w) => w.reason).length / wk.length : null;
  const score = Math.round(100 * (reasonRate === null ? coverage : 0.6 * coverage + 0.4 * reasonRate));
  const letter = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { score, letter, coverage, reasonRate };
}

// --------------------------------------------------------- Google reviews

/**
 * Bloco de reputação (2026-11-25): números do Google Business
 * Profile gravados pelo coletor de reputação (lib/reputation.ts).
 * Aparece só quando existe snapshot; sem ele, a pendência da conta
 * continua dizendo que a fonte não está ligada.
 */
function ReviewsCard({ rep }: { rep: import("@/lib/reputation").ReputationSnapshot }) {
  const collected = new Date(rep.collectedAt).toLocaleString("en-US", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ,
  });
  const prevAvg = [...rep.history].reverse().find(
    (h) => h.averageRating !== null && new Date(h.date).getTime() <= Date.now() - 30 * 86_400_000,
  )?.averageRating ?? null;
  const avgDelta = prevAvg !== null && rep.averageRating !== null ? rep.averageRating - prevAvg : null;
  const hasActions = [rep.calls30, rep.websiteClicks30, rep.directions30].some((v) => v !== null && v !== undefined);
  return (
    <>
      <h2>Google reviews{rep.title ? ` · ${rep.title}` : ""}</h2>
      <div className="card" title="Source: Google Business Profile, daily snapshot from the reputation collector.">
        {rep.error && (
          <p className="hint" style={{ color: "#FFD97C", marginBottom: 10 }}>
            Last collection failed ({rep.error}); showing the last good numbers.
          </p>
        )}
        <div className="kpis" style={{ marginTop: 4 }}>
          <div>
            <div className="label">Average rating</div>
            <div className="value">{rep.averageRating !== null ? `${rep.averageRating.toFixed(1)}★` : "—"}</div>
            <div className="hint">
              {avgDelta !== null ? `${avgDelta >= 0 ? "+" : ""}${avgDelta.toFixed(2)} vs 30 days ago` : "no 30-day baseline yet"}
            </div>
          </div>
          <div>
            <div className="label">Total reviews</div>
            <div className="value">{rep.totalReviews.toLocaleString("en-US")}</div>
            <div className="hint">{rep.replied.toLocaleString("en-US")} replied · {rep.unreplied.toLocaleString("en-US")} without reply</div>
          </div>
          <div>
            <div className="label">New · 30 days</div>
            <div className="value">{rep.new30}</div>
            <Delta cur={rep.new30} prev={rep.newPrev30} />
          </div>
          <div>
            <div className="label">Replies · 30 days</div>
            <div className="value">{rep.repliedLast30}</div>
            <div className="hint">
              {rep.avgReplyHours !== null
                ? `avg reply time ${rep.avgReplyHours < 48 ? `${Math.round(rep.avgReplyHours)} h` : `${(rep.avgReplyHours / 24).toFixed(1)} d`}`
                : "reply time not measured yet"}
            </div>
          </div>
        </div>
        {(() => {
          const ratingSeries = rep.history.map((h) => h.averageRating).filter((v): v is number => v !== null && v !== undefined);
          const replySeries = rep.history.map((h) => h.avgReplyHours).filter((v): v is number => v !== null && v !== undefined);
          const fmtH = (v: number) => (v < 48 ? `${Math.round(v)} h` : `${(v / 24).toFixed(1)} d`);
          if (ratingSeries.length < 2 && replySeries.length < 2) return null;
          return (
            <div className="kpis" style={{ marginTop: 14 }}>
              {ratingSeries.length > 1 && (
                <div>
                  <div className="label">Average rating · over time</div>
                  <Spark data={ratingSeries} w={230} h={38} />
                  <div className="hint">{ratingSeries[0].toFixed(2)}★ → {ratingSeries[ratingSeries.length - 1].toFixed(2)}★ · {ratingSeries.length} daily snapshots</div>
                </div>
              )}
              {replySeries.length > 1 && (
                <div>
                  <div className="label">Avg reply time · over time</div>
                  <Spark data={replySeries} w={230} h={38} stroke="#7CC4FF" />
                  <div className="hint">{fmtH(replySeries[0])} → {fmtH(replySeries[replySeries.length - 1])} · lower is better · {replySeries.length} daily snapshots</div>
                </div>
              )}
            </div>
          );
        })()}
        <p className="hint" style={{ marginTop: 10 }}>
          Review requests sent: they go out through the HighLevel review flow, and neither Google nor the HighLevel API exposes that count for this account, so it is not shown here instead of being estimated.
        </p>
        {hasActions && (
          <p className="hint" style={{ marginTop: 10 }}>
            Profile actions, last 30 days: {rep.calls30 ?? "—"} calls · {rep.websiteClicks30 ?? "—"} website clicks · {rep.directions30 ?? "—"} direction requests.
          </p>
        )}
        {rep.negativeUnreplied.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="label" style={{ color: "#FF6B6B" }}>Negative reviews without a reply · {rep.negativeUnreplied.length}</div>
            {rep.negativeUnreplied.map((r, i) => (
              <div className="conv" key={`${r.name}-${i}`}>
                <span>
                  <b>{"★".repeat(r.rating)}</b> {r.name}
                  {r.when ? <small className="note"> · {new Date(r.when).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ })}</small> : null}
                  {r.excerpt ? <span style={{ color: "#B7A69B" }}> · “{r.excerpt}”</span> : null}
                </span>
                {r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "#F0772E", fontWeight: 600, fontSize: 13, textDecoration: "none" }}>Open</a> : null}
              </div>
            ))}
          </div>
        )}
        <p className="hint" style={{ marginTop: 10 }}>Snapshot from {collected} Chicago · Google Business Profile location {rep.gbpLocation}</p>
      </div>
    </>
  );
}
