// Bloco de KPIs do SERVIÇO CONTRATADO (personalização por cliente,
// ordem do Lucas, 2026-11-22). A configuração de cada conta mora em
// lib/services.ts (lida do Notion); aqui só a apresentação, sempre a
// partir de dados reais da coleta. O que a fonte não entrega aparece
// como pendência escrita, nunca como número inventado.
import type { AccountDetail } from "@/lib/hl";
import { money } from "@/lib/insights";
import { SERVICE_CONFIG } from "@/lib/services";

export default function ServiceSection({ slug, detail }: { slug: string; detail: AccountDetail }) {
  const cfg = SERVICE_CONFIG[slug];
  if (!cfg) return null;
  const m = detail.metrics;
  const group = cfg.stagesPipeline
    ? detail.stageGroups.find((g) => g.pipeline.toLowerCase().includes(cfg.stagesPipeline!.toLowerCase()))
    : undefined;
  const formTotal = m.sourceCounts["Form"] ?? 0;
  const maxStage = group ? Math.max(1, ...group.stages.map((s) => s.count)) : 1;

  return (
    <>
      <h2>Contracted service · {cfg.title}</h2>
      <div className="card">
        <div className="label">{cfg.kpiLabel}</div>
        {cfg.note && <p className="hint" style={{ marginTop: 8, maxWidth: 720 }}>{cfg.note}</p>}

        {cfg.showCalls && (
          <div style={{ marginTop: 16 }}>
            <div className="label">
              Calls{cfg.callAgent ? ` · ${cfg.callAgent}` : ""} · recent conversation window
            </div>
            {detail.calls ? (
              <>
                <div className="kpis" style={{ marginTop: 12 }}>
                  <div>
                    <div className="label">Call conversations</div>
                    <div className="value">{detail.calls.callConversations}</div>
                    <div className="hint">of {detail.calls.windowSize} conversations in the window</div>
                  </div>
                  <div>
                    <div className="label">Inbound / outbound</div>
                    <div className="value">
                      {detail.calls.inbound} / {detail.calls.outbound}
                    </div>
                    <div className="hint">by the last message direction</div>
                  </div>
                  <div>
                    <div className="label">Active · 7 days</div>
                    <div className="value">{detail.calls.activity7d}</div>
                    <div className="hint">{detail.calls.activity30d} active in 30 days</div>
                  </div>
                  <div>
                    <div className="label">Last activity was the call</div>
                    <div className="value">{detail.calls.lastWasCall}</div>
                    <div className="hint">the rest continued by message</div>
                  </div>
                </div>
              </>
            ) : (
              <p className="hint" style={{ marginTop: 8 }}>The conversation search did not answer in this load.</p>
            )}
          </div>
        )}

        {cfg.showWon && detail.won && (
          <div style={{ marginTop: 16 }}>
            <div className="label">Closed (won) in the loaded window</div>
            <div className="kpis" style={{ marginTop: 12 }}>
              <div>
                <div className="label">Won</div>
                <div className="value">{detail.won.count}</div>
                <div className="hint">{money(detail.won.value)} total value</div>
              </div>
              <div>
                <div className="label">Won · last 30 days</div>
                <div className="value">{detail.won.last30Count}</div>
                <div className="hint">{money(detail.won.last30Value)}</div>
              </div>
              <div>
                <div className="label">Lost</div>
                <div className="value">{detail.won.lostCount}</div>
                <div className="hint">in the same window</div>
              </div>
            </div>
          </div>
        )}

        {group && group.stages.length > 0 && (
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
        )}

        {cfg.formKpi && (
          <div style={{ marginTop: 16 }}>
            <div className="label">Form leads · last 30 days</div>
            <div className="value">{formTotal}</div>
            {detail.formSources30d.length > 0 ? (
              <div style={{ marginTop: 4 }}>
                {detail.formSources30d.map((f) => (
                  <div className="conv" key={f.label}>
                    <span>{f.label}</span>
                    <b>{f.count}</b>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hint">No form-sourced contacts in the last 30 days.</p>
            )}
          </div>
        )}

        {cfg.pendencies.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="label">Not measurable yet</div>
            <ul className="steps" style={{ marginTop: 4 }}>
              {cfg.pendencies.map((p, i) => (
                <li key={i}><span className="todo">→</span> {p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
