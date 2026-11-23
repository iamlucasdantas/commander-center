// PAINEL VERCEL (unificação, ordem do Lucas, 2026-11-22): o que
// foi publicado, sem sair do Commander Center. Projetos e deploys
// lidos pelo coletor diário no ambiente da Muse (conector Vercel)
// e gravados como snapshot (lib/command.ts). Leitura apenas: nenhum
// deploy é disparado daqui.
// Referências de desenho: o próprio dashboard da Vercel (cartão por
// projeto, estado do deploy em destaque) e o Linear (linha do tempo
// limpa). Tudo em America/Chicago.
import Link from "next/link";
import { getCommand, type VercelDeployment } from "@/lib/command";
import { TZ } from "@/components/viz";

export const dynamic = "force-dynamic";

type StateKind = "ready" | "error" | "building" | "other";

function stateKind(state: string): StateKind {
  const s = state.toUpperCase();
  if (s === "READY") return "ready";
  if (s === "ERROR" || s === "CANCELED") return "error";
  if (s === "BUILDING" || s === "QUEUED" || s === "INITIALIZING") return "building";
  return "other";
}

function relTime(iso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${String(mins % 60).padStart(2, "0")}m ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ,
  });
}

function deployMeta(d: VercelDeployment): string {
  const parts: string[] = [];
  if (d.target) parts.push(d.target);
  if (d.branch) parts.push(d.branch);
  if (d.commitSha) parts.push(d.commitSha.slice(0, 7));
  return parts.join(" · ");
}

export default async function VercelPage() {
  const command = await getCommand();
  const vercel = command.vercel;
  const now = new Date();

  const allDeployments = (vercel?.projects ?? [])
    .flatMap((p) => p.deployments.map((d) => ({ project: p.name, d })))
    .sort((a, b) => (a.d.createdAt < b.d.createdAt ? 1 : -1));
  const latest = allDeployments[0];
  const readyCount = (vercel?.projects ?? []).filter((p) => {
    const prod = p.deployments.find((d) => d.target === "production") ?? p.deployments[0];
    return prod && stateKind(prod.state) === "ready";
  }).length;

  const collectedLabel = vercel
    ? new Date(vercel.collectedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ })
    : null;

  return (
    <div className="wrap">
      <Link className="backlink" href="/">← Commander Center</Link>
      <header className="topo">
        <div>
          <div className="heatbar"><i /><i /><i /><i /></div>
          <div className="wordmark">MAGNETIC FUNNELS</div>
          <h1>Vercel</h1>
        </div>
      </header>
      <p className="sub">
        Projects and deployments, read from Vercel by the daily collector
        {vercel ? <> · snapshot {collectedLabel} (Chicago)</> : null}
      </p>

      {!vercel || vercel.projects.length === 0 ? (
        <div className="card statuscard">
          <div className="statusbig">Waiting for the first Vercel snapshot</div>
          <p className="hint" style={{ marginTop: 8, maxWidth: 560 }}>
            The daily collector lists the projects and their latest deployments in the Vercel team
            and records the snapshot here. None has arrived yet.
          </p>
        </div>
      ) : (
        <>
          {vercel.errors.length > 0 && (
            <div className="unvsummary" style={{ marginBottom: 14 }}>
              <b>Partial snapshot:</b> {vercel.errors.join(" · ")}
            </div>
          )}

          <div className="kpis">
            <div className="card">
              <div className="label">Projects</div>
              <div className="value">{vercel.projects.length}</div>
              <div className="hint">in the Vercel team</div>
            </div>
            <div className="card">
              <div className="label">Production ready</div>
              <div className="value">{readyCount} of {vercel.projects.length}</div>
              <div className="hint">latest production deploy is READY</div>
            </div>
            <div className="card">
              <div className="label">Latest deploy</div>
              {latest ? (
                <>
                  <div className="value" style={{ fontSize: 24, lineHeight: 1.2 }}>{latest.project}</div>
                  <div className="hint">{relTime(latest.d.createdAt, now)} · {latest.d.state}</div>
                </>
              ) : (
                <div className="hint" style={{ marginTop: 10 }}>No deployments in the snapshot.</div>
              )}
            </div>
          </div>

          <h2>Projects</h2>
          <div className="socialgrid">
            {vercel.projects.map((p) => {
              const prod = p.deployments.find((d) => d.target === "production") ?? p.deployments[0];
              const siteUrl = p.productionDomain ? `https://${p.productionDomain}` : prod ? `https://${prod.url}` : null;
              return (
                <div className="card" key={p.id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className={`statedot ${prod ? stateKind(prod.state) : "other"}`} />
                    <div style={{ fontSize: 16.5, fontWeight: 700 }}>{p.name}</div>
                    {prod && <span className={`statechip ${stateKind(prod.state)}`} style={{ marginLeft: "auto" }}>{prod.state}</span>}
                  </div>
                  {p.productionDomain && <div className="hint" style={{ marginTop: 5 }}>{p.productionDomain}</div>}
                  {prod ? (
                    <div style={{ marginTop: 12, display: "grid", gap: 5, fontSize: 13.5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ color: "#B7A69B" }}>Last deploy</span><b>{relTime(prod.createdAt, now)}</b>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ color: "#B7A69B" }}>When</span><b>{fmtWhen(prod.createdAt)}</b>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ color: "#B7A69B" }}>Target</span><b>{deployMeta(prod) || "production"}</b>
                      </div>
                      {prod.commitMessage && (
                        <div style={{ color: "#CBBBAE", marginTop: 4 }}>{prod.commitMessage}</div>
                      )}
                    </div>
                  ) : (
                    <p className="hint" style={{ marginTop: 10 }}>No deployments collected for this project.</p>
                  )}
                  <div style={{ marginTop: 12, display: "flex", gap: 14 }}>
                    {siteUrl && (
                      <a className="acctlink" href={siteUrl} target="_blank" rel="noreferrer" style={{ color: "#F0772E", fontWeight: 600, fontSize: 13 }}>
                        Open site →
                      </a>
                    )}
                    {prod && (
                      <a className="acctlink" href={prod.inspectorUrl} target="_blank" rel="noreferrer" style={{ color: "#F0772E", fontWeight: 600, fontSize: 13 }}>
                        Inspector →
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <h2>Latest deployments · all projects</h2>
          <div className="card">
            {allDeployments.slice(0, 15).map(({ project, d }) => (
              <div className="deployrow" key={d.id}>
                <span className={`statedot ${stateKind(d.state)}`} style={{ marginTop: 5 }} />
                <span>
                  <b>{project}</b> · {d.commitMessage ?? "Deployment"}
                  <small>{fmtWhen(d.createdAt)} · {relTime(d.createdAt, now)}{deployMeta(d) ? ` · ${deployMeta(d)}` : ""}</small>
                </span>
                <span className="deploylinks">
                  <span className={`statechip ${stateKind(d.state)}`}>{d.state}</span>
                  <a href={`https://${d.url}`} target="_blank" rel="noreferrer">Deploy</a>
                  <a href={d.inspectorUrl} target="_blank" rel="noreferrer">Inspector</a>
                </span>
              </div>
            ))}
          </div>

          <p className="foot">
            Vercel data from the daily collector snapshot. Read only: deployments are managed in Vercel and GitHub, never from this panel.
          </p>
        </>
      )}
    </div>
  );
}
