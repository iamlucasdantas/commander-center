import { ACCOUNTS, type Account } from "@/lib/accounts";
import { fetchAccountMetrics, type AccountMetrics } from "@/lib/hl";
import RefreshButton from "@/components/RefreshButton";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<Account["kind"], string> = {
  empresa: "Empresa",
  comunidade: "Comunidade",
  cliente: "Cliente",
  projeto: "Projeto",
  potencial: "Potencial",
};

function hasToken(a: Account): boolean {
  return Boolean(a.pitEnv && process.env[a.pitEnv]);
}

function statusPill(a: Account): { label: string; cls: string } {
  if (a.sourceStatus === "hl-location") return { label: "Aguardando token", cls: "token" };
  if (a.sourceStatus === "propria") return { label: "Fonte própria", cls: "propria" };
  if (a.sourceStatus === "sem-subconta") return { label: "Sem conta ainda", cls: "semconta" };
  return { label: "Fonte a mapear", cls: "mapear" };
}

function trend(m: AccountMetrics): { txt: string; cls: string } {
  if (m.leadsPrev7d === 0) return m.leads7d > 0 ? { txt: "novo", cls: "up" } : { txt: "—", cls: "" };
  const pct = Math.round(((m.leads7d - m.leadsPrev7d) / m.leadsPrev7d) * 100);
  if (pct > 0) return { txt: `▲ ${pct}%`, cls: "up" };
  if (pct < 0) return { txt: `▼ ${Math.abs(pct)}%`, cls: "down" };
  return { txt: "estável", cls: "" };
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

  const topAccount = ligadas
    .map((a) => ({ a, m: metrics.get(a.slug) }))
    .filter((x) => x.m?.ok)
    .sort((x, y) => (y.m!.leads7d - x.m!.leads7d))[0];
  const worstUnread = ligadas
    .map((a) => ({ a, m: metrics.get(a.slug) }))
    .filter((x) => x.m?.ok && x.m.unread > 0)
    .sort((x, y) => (y.m!.unread - x.m!.unread))[0];
  const growth = ligadas
    .map((a) => ({ a, m: metrics.get(a.slug) }))
    .filter((x) => x.m?.ok && x.m.leadsPrev7d > 0)
    .sort((x, y) => (y.m!.leads7d - y.m!.leadsPrev7d) / y.m!.leadsPrev7d - (x.m!.leads7d - x.m!.leadsPrev7d) / x.m!.leadsPrev7d)[0];

  const grupos: Array<{ titulo: string; kinds: Account["kind"][] }> = [
    { titulo: "Empresa e comunidade", kinds: ["empresa", "comunidade"] },
    { titulo: "Clientes", kinds: ["cliente"] },
    { titulo: "Marcas e projetos próprios", kinds: ["projeto"] },
  ];
  const agora = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="wrap">
      <header className="topo">
        <h1><span className="magnet">🧲 Commander</span> Center</h1>
        <span style={{ marginLeft: "auto" }}><RefreshButton /></span>
      </header>
      <p className="sub">Visão geral, todas as contas. Leads limpos, sem os fakes. Atualizado {agora}. {ligadas.length} de {conectaveis.length} contas com location já estão ligadas.</p>

      <div className="kpis">
        <div className="card"><div className="label">Leads novos 7d (limpos)</div><div className="value">{leads7d}</div><div className={leads7d >= leadsPrev ? "up" : "down"}>{leadsPrev ? `vs ${leadsPrev} na semana anterior` : "primeira leitura"}</div></div>
        <div className="card"><div className="label">Leads hoje</div><div className="value">{leadsHoje}</div><div className="hint">nas contas ligadas</div></div>
        <div className="card"><div className="label">Conversas não lidas</div><div className="value">{unread}</div><div className={unread ? "down" : "up"}>{contasComUnread ? `${contasComUnread} conta(s) esperando resposta` : "nada esperando"}</div></div>
        <div className="card"><div className="label">Oportunidades abertas</div><div className="value">{money(oppValue)}</div><div className="hint">{oppCount} oportunidades abertas</div></div>
        <div className="card"><div className="label">Fakes em quarentena</div><div className="value">{allFakes.length}</div><div className={allFakes.length ? "down" : "hint"}>{allFakes.length ? "fora das métricas" : "nenhum nos últimos 30 dias"}</div></div>
        <div className="card"><div className="label">Contas ligadas</div><div className="value">{okMetrics.length}/{conectaveis.length}</div><div className="warn">{conectaveis.length - ligadas.length} aguardando token</div></div>
      </div>

      {worstUnread && (
        <div className="alert"><b>⚠ Insight:</b> {worstUnread.a.name} tem {worstUnread.m!.unread} conversa(s) não lida(s) esperando resposta. É a maior fila entre as contas ligadas.</div>
      )}
      {growth && growth.m!.leads7d !== growth.m!.leadsPrev7d && (
        <div className="alert ok"><b>✓ Insight:</b> {growth.a.name}: leads foram de {growth.m!.leadsPrev7d} pra {growth.m!.leads7d} na semana. {growth.m!.leads7d > growth.m!.leadsPrev7d ? "Subiu bem, vale olhar o que mudou na página e nas campanhas." : "Caiu, vale investigar a origem antes que vire tendência."}</div>
      )}
      {ligadas.length < conectaveis.length && (
        <div className="alert"><b>⚠ Coleta parcial:</b> {conectaveis.length - ligadas.length} contas com location ainda estão sem token no Vercel, então os números acima são só das {okMetrics.length} ligadas. Quando os tokens entrarem, o painel fica completo sozinho.</div>
      )}

      <div className="chart">
        <div className="label" style={{ color: "#9FB2C3", fontSize: 12, textTransform: "uppercase", letterSpacing: .6 }}>Leads por dia, agregado das contas ligadas, 14 dias</div>
        <svg viewBox="0 0 600 180" width="100%" height="150" preserveAspectRatio="none" style={{ marginTop: 10 }}>
          <polyline fill="none" stroke="#3DDC84" strokeWidth="2.5" points={chartPoints} />
        </svg>
        <div style={{ fontSize: 12, color: "#9FB2C3" }}><span style={{ color: "#3DDC84" }}>—</span> leads limpos por dia. A linha de acessos entra quando o GA4 for ligado, pra cruzar tráfego com lead e diagnosticar queda.</div>
      </div>

      {grupos.map((g) => (
        <section key={g.titulo}>
          <h2>{g.titulo}</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Conta</th><th>Tipo</th><th>Leads 7d</th><th>Não lidas</th><th>Oportunidades</th><th>Tendência</th><th></th></tr>
              </thead>
              <tbody>
                {contas.filter((a) => g.kinds.includes(a.kind)).map((a) => {
                  const m = metrics.get(a.slug);
                  const pill = statusPill(a);
                  return (
                    <tr key={a.slug}>
                      <td><b>{a.name}</b>{a.note && <small className="note">{a.note}</small>}</td>
                      <td>{KIND_LABEL[a.kind]}</td>
                      {m?.ok ? (
                        <>
                          <td>{m.leads7d}</td>
                          <td>{m.unread}</td>
                          <td>{money(m.opportunitiesValue)}</td>
                          <td className={trend(m).cls}>{trend(m).txt}</td>
                          <td><RefreshButton slug={a.slug} mini /></td>
                        </>
                      ) : (
                        <>
                          <td colSpan={4}><span className={`pill ${pill.cls}`}>{hasToken(a) ? "Ligada, lendo dados" : pill.label}</span></td>
                          <td>{a.sourceStatus === "hl-location" || a.sourceStatus === "propria" ? <RefreshButton slug={a.slug} mini /> : null}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <div className="grid2">
        <div className="card">
          <div className="label">Drill-down{topAccount ? `, ${topAccount.a.name}, leads da semana` : ""}</div>
          {topAccount?.m?.recentLeads.length ? (
            topAccount.m.recentLeads.map((l, i) => (
              <div className="lead" key={i}>
                <span>{l.name}<br /><small>{l.when}, {l.sourceLabel}</small></span>
                <span className={`tag${l.emailOnly ? " email" : ""}`}>{l.emailOnly ? "não verificado" : "lead"}</span>
              </div>
            ))
          ) : (
            <p style={{ fontSize: 14, color: "#9FB2C3", marginTop: 8 }}>Nenhum lead nos últimos 7 dias nas contas ligadas.</p>
          )}
        </div>
        <div className="card">
          <div className="label">Quarentena de fakes, fora das métricas</div>
          {allFakes.length ? (
            allFakes.slice(0, 8).map((f, i) => (
              <div className="fake" key={i}>
                <span>{f.name}<br /><small>{f.account}, {f.reason}</small></span>
                <span className="tag email">fake</span>
              </div>
            ))
          ) : (
            <p style={{ fontSize: 14, color: "#9FB2C3", marginTop: 8 }}>Nenhum fake detectado nos últimos 30 dias nas contas ligadas. American Express, Verizon e Better Business Bureau são barrados pela regra de nome.</p>
          )}
        </div>
      </div>

      <h2>Onde estamos</h2>
      <div className="card">
        <ul className="steps">
          <li><span className="done">✓</span> Painel no ar com a cara do mockup aprovado, GitHub e Vercel ligados</li>
          <li><span className="done">✓</span> Coleta ao vivo do HighLevel ligada: leads com nome e origem, não lidas, oportunidades, fakes fora</li>
          <li><span className="todo">→</span> Tokens das contas restantes no Vercel, pra completar as {conectaveis.length} com location</li>
          <li><span className="todo">→</span> GA4 pra cruzar acessos com leads e diagnosticar queda</li>
          <li><span className="todo">→</span> Histórico com snapshots diários e mapeamento das fontes dos clientes sem location</li>
        </ul>
      </div>

      <p className="foot">Commander Center. Números lidos ao vivo do HighLevel a cada abertura, com cache de 5 minutos.</p>
    </div>
  );
}
